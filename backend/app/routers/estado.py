"""GET /api/estado-ingesta — salud de la ingesta, visible para la UI.

Permite distinguir dos situaciones que hoy se ven idénticas en el visor: "la flota
está detenida" (datos frescos, aeronaves quietas) y "la ingesta está caída" (nadie
está trayendo datos). Sin esto, una key rotada o Nexe caído se parecen a una tarde
tranquila.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import consultas
from ..db.session import get_db
from ..servicios.geojson import iso

router = APIRouter()

# Con una corrida por minuto, más de 5 min sin corrida OK es una ingesta detenida
# (el mismo umbral con el que la UI marca un recurso "sin señal reciente").
UMBRAL_INGESTA_DETENIDA_MIN = 5


@router.get("/api/estado-ingesta")
def estado_ingesta(db: Session = Depends(get_db)) -> dict[str, Any]:
    fila = consultas.estado_ingesta(db) or {}
    totales = consultas.resumen(db)

    ultima_ok: datetime | None = fila.get("ultima_corrida_ok_en")
    minutos = None
    if ultima_ok is not None:
        if ultima_ok.tzinfo is None:
            ultima_ok = ultima_ok.replace(tzinfo=timezone.utc)
        minutos = (datetime.now(timezone.utc) - ultima_ok).total_seconds() / 60

    return {
        "cursor": iso(fila.get("cursor_data_ctr_time")),
        "ultimaCorridaEn": iso(fila.get("ultima_corrida_en")),
        "ultimaCorridaOkEn": iso(ultima_ok),
        "minutosDesdeUltimaCorridaOk": None if minutos is None else round(minutos, 1),
        "ingestaDetenida": minutos is None or minutos > UMBRAL_INGESTA_DETENIDA_MIN,
        "posicionesUltimaCorrida": fila.get("posiciones_ultima_corrida"),
        "fallosConsecutivos": fila.get("fallos_consecutivos"),
        "ultimoErrorEn": iso(fila.get("ultimo_error_en")),
        "ultimoErrorClase": fila.get("ultimo_error_clase"),
        "acumulado": {
            "posiciones": totales.get("posiciones"),
            "recursos": totales.get("recursos"),
            "primeraPosicion": iso(totales.get("primera_posicion")),
            "ultimaPosicion": iso(totales.get("ultima_posicion")),
        },
    }
