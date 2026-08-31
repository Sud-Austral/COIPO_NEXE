"""Cliente HTTP de Nexe (AFF JSON) — ÚNICO lugar donde se arma el body y se pagina.

Equivalente Python de `frontend/src/api/contract.ts` + la paginación de
`usePolling`, extraído de `descargar_historico_nexe.py` (probado contra staging
real el 7-jul-2026). Tras esta migración, el collector es el ÚNICO consumidor de
Nexe en toda la infraestructura: ni el backend ni el navegador le hablan.

Contrato CONFIRMADO (CLAUDE.md §2 y §7.2):
- POST con header `api-key`; `GET` responde 405.
- Body `{type:"dataRequest", dataCenter:[{affVer,name,reqTime}],
  msgRequest:[{to,from,msgType,dataCtrTime}]}`. Los tres campos raíz y los cinco
  placeholders son OBLIGATORIOS (omitirlos da 422 `Field required`); el servidor
  acepta el literal "string" como valor de affVer/name/to/from/msgType.
- `dataCtrTime` es el filtro y es estrictamente MAYOR (`>`).
- Límite EXACTO de 1000 posiciones por respuesta: se pagina repitiendo con el
  último `dataCtrTime` recibido.
- Listas vacías en dataCenter/msgRequest -> 500 (nunca enviarlas).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterator

from .aplanado import aplanar_coleccion, max_data_ctr_time

logger = logging.getLogger(__name__)

TIPO_PETICION = "dataRequest"
PLACEHOLDER = "string"  # literal del ejemplo oficial de Nexe; el servidor lo acepta

LIMITE_PAGINA = 1000  # límite real observado
UMBRAL_PAGINA_LLENA = 900  # menos features que esto = ya no hay más páginas
ESPERAS_REINTENTO = (5, 10, 20)  # backoff ante 5xx / red

RUTA_GET = "position/affjson/get"
RUTA_LASTPOSITIONS = "position/affjson/get_lastpositions"


class NexeError(Exception):
    """Base de los errores de Nexe."""


class ClaveRechazada(NexeError):
    """401: api-key inválida o rotada. Requiere intervención humana, no reintentos."""


class ContratoRechazado(NexeError):
    """422: el body ya no calza con lo que Nexe espera (CLAUDE.md §14.6)."""

    def __init__(self, detalle: str) -> None:
        super().__init__("Nexe rechazó el body (422): contrato desalineado")
        self.detalle = detalle


class NexeNoDisponible(NexeError):
    """5xx o error de red tras agotar los reintentos."""


def iso_utc(momento: datetime) -> str:
    """datetime -> ISO 8601 UTC con milisegundos y Z, el formato que exige Nexe.

    Trunca los microsegundos hacia ABAJO a propósito: Nexe entrega dataCtrTime con
    6 decimales pero su ejemplo oficial usa 3, así que el cursor se redondea hacia
    atrás. Consecuencia observada: se puede repetir la última posición de la tanda
    anterior (el dedupe por (esn, pos_time) la descarta). Redondear hacia arriba,
    en cambio, saltaría registros — por eso nunca se hace.
    """
    return momento.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def cuerpo_data_request(
    data_ctr_time: datetime | str,
    *,
    domain: list[str] | None = None,
    ahora: datetime | None = None,
) -> dict[str, Any]:
    """Body oficial de Nexe. `domain` solo aplica a get_lastpositions.

    OJO con `domain`: la forma correcta es LISTA (con string da 422), pero staging
    devuelve 500 con valores válidos — bug escalado a Nexe. El collector no lo usa;
    el filtro por familia se resuelve en nuestra base (/api/recursos?familia=).
    """
    filtro = data_ctr_time if isinstance(data_ctr_time, str) else iso_utc(data_ctr_time)
    msg: dict[str, Any] = {
        "to": PLACEHOLDER,
        "from": PLACEHOLDER,
        "msgType": PLACEHOLDER,
        "dataCtrTime": filtro,
    }
    if domain:
        msg["domain"] = list(domain)
    return {
        "type": TIPO_PETICION,
        "dataCenter": [
            {
                "affVer": PLACEHOLDER,
                "name": PLACEHOLDER,
                "reqTime": iso_utc(ahora or datetime.now(timezone.utc)),
            }
        ],
        "msgRequest": [msg],
    }


@dataclass
class Pagina:
    """Una respuesta de /get ya aplanada."""

    filas: list[dict[str, Any]] = field(default_factory=list)
    descartadas: int = 0
    crudas: int = 0  # features tal como las mandó Nexe (define si la página está llena)
    cursor: datetime | None = None  # máximo data_ctr_time de ESTA página

    @property
    def llena(self) -> bool:
        return self.crudas >= UMBRAL_PAGINA_LLENA


class ClienteNexe:
    """POST a Nexe con la key inyectada y paginación por dataCtrTime.

    `sesion` es cualquier objeto con `.post(url, json=..., headers=..., timeout=...)`
    que devuelva algo con `.status_code`, `.json()` y `.text` — en producción es un
    `requests.Session`; en los tests, un doble sin red.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout: int = 60,
        sesion: Any | None = None,
        dormir: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key:
            raise ValueError("ClienteNexe requiere una api_key no vacía")
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key  # nunca se loguea ni se devuelve (CLAUDE.md §14.1)
        self.timeout = timeout
        self._dormir = dormir
        if sesion is None:
            import requests  # importado aquí para que los tests no lo necesiten

            sesion = requests.Session()
        self._sesion = sesion

    # ── HTTP ──────────────────────────────────────────────────────────────────

    def _post(self, ruta: str, cuerpo: dict[str, Any]) -> dict[str, Any]:
        cabeceras = {"api-key": self._api_key, "Content-Type": "application/json"}
        ultimo_error: str = "sin intentos"
        for espera in (0, *ESPERAS_REINTENTO):
            if espera:
                logger.warning("Nexe no respondió; reintento en %s s", espera)
                self._dormir(espera)
            try:
                respuesta = self._sesion.post(
                    f"{self.base_url}/{ruta}",
                    json=cuerpo,
                    headers=cabeceras,
                    timeout=self.timeout,
                )
            except Exception as error:  # red caída, DNS, timeout…
                ultimo_error = f"{type(error).__name__}"
                continue

            estado = respuesta.status_code
            if estado == 200:
                return respuesta.json()
            if estado == 401:
                raise ClaveRechazada(
                    "Nexe rechazó la api-key (401). Pedir la key vigente; el cursor "
                    "de ingesta NO se toca."
                )
            if estado == 422:
                raise ContratoRechazado(respuesta.text[:500])
            ultimo_error = f"HTTP {estado}"

        raise NexeNoDisponible(f"Nexe no respondió tras los reintentos ({ultimo_error})")

    # ── Consultas ─────────────────────────────────────────────────────────────

    def pagina_desde(self, cursor: datetime | str) -> Pagina:
        """Una sola llamada a /get: posiciones llegadas DESPUÉS (>) de `cursor`."""
        cruda = self._post(RUTA_GET, cuerpo_data_request(cursor))
        filas, descartadas = aplanar_coleccion(cruda)
        crudas = len(cruda.get("features") or []) if isinstance(cruda, dict) else 0
        return Pagina(
            filas=filas,
            descartadas=descartadas,
            crudas=crudas,
            cursor=max_data_ctr_time(filas),
        )

    def paginas_desde(
        self, cursor: datetime | str, *, max_paginas: int = 20
    ) -> Iterator[Pagina]:
        """Itera las páginas de /get avanzando el cursor hasta que venga una corta.

        El consumidor debe persistir cada página ANTES de pedir la siguiente: así
        una caída a mitad de la paginación no pierde lo ya traído, y el cursor
        guardado siempre corresponde a datos efectivamente almacenados.
        """
        actual = cursor if isinstance(cursor, str) else iso_utc(cursor)
        for numero in range(1, max_paginas + 1):
            pagina = self.pagina_desde(actual)
            yield pagina

            if pagina.cursor is None:
                logger.info("Página %s sin cursor nuevo: fin de la paginación", numero)
                return
            siguiente = iso_utc(pagina.cursor)
            if siguiente <= actual:  # sin avance posible: evita un bucle infinito
                logger.info("El cursor no avanzó en la página %s: fin", numero)
                return
            actual = siguiente
            if not pagina.llena:
                return
        logger.warning(
            "Se alcanzó el tope de %s páginas en una corrida; el resto queda para la "
            "siguiente (el cursor persistido no pierde nada)",
            max_paginas,
        )

    def ultimas_posiciones(
        self, desde: datetime | str, *, domain: list[str] | None = None
    ) -> list[dict[str, Any]]:
        """get_lastpositions: última posición de cada recurso + metadatos hg*.

        `desde` conviene amplio (p. ej. 14 días: el mínimo de almacenamiento del
        estándar AFF), porque la copia de staging corre días detrás del presente.
        """
        cruda = self._post(RUTA_LASTPOSITIONS, cuerpo_data_request(desde, domain=domain))
        filas, _ = aplanar_coleccion(cruda)
        return filas
