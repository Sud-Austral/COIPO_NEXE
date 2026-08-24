"""Aplanado y normalización de la respuesta de Nexe (GeoJSON FeatureCollection).

Equivalente Python de `frontend/src/api/parse.ts` y de `aplanar_feature()` del
extractor `descargar_historico_nexe.py` (ya probado contra staging real). Es la
frontera entre el vocabulario de Nexe y el nuestro:

    geometry.coordinates = [lon, lat]   ->  longitud / latitud   (¡ese orden!)
    cog                                 ->  rumbo
    spd                                 ->  velocidad            (valor CRUDO, §2)
    fix                                 ->  fix_type
    alt                                 ->  altitud
    hgNavstate: "2" (string)            ->  hg_navstate: 2 (int)
    hgExtName, hgAsset, ...             ->  hg_ext_name, hg_asset, ...

Módulo PURO: sin red, sin base de datos. Lo importan el collector y los tests.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Columnas de `recurso` (metadatos). Solo llegan completas por get_lastpositions
# (CLAUDE.md §7.3): en /get únicamente viene hg_ext_name — y a veces unit_id.
CAMPOS_RECURSO: tuple[str, ...] = (
    "unit_id",
    "hg_ext_name",
    "hg_alias",
    "hg_asset",
    "hg_asset_model",
    "hg_asset_family",
    "hg_family_type",
    "hg_company",
    "hg_source",
    "hg_navstate",
)

# Columnas de `posicion` (telemetría), en el orden del INSERT del collector.
CAMPOS_POSICION: tuple[str, ...] = (
    "esn",
    "pos_time",
    "data_ctr_time",
    "latitud",
    "longitud",
    "altitud",
    "velocidad",
    "rumbo",
    "fix_type",
    "src",
    "pdop",
    "hdop",
    "unit_id",
    "hg_ext_name",
)

_FIX_VALIDOS = {"3d": "3D", "2d": "2D", "invalid": "Invalid"}
_NAVSTATES_VALIDOS = {2, 4, 5}


def _como_texto(valor: Any) -> str | None:
    if isinstance(valor, str):
        return valor or None
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        return str(valor)
    return None


def _como_numero(valor: Any) -> float | None:
    if isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    if isinstance(valor, str) and valor.strip():
        try:
            return float(valor)
        except ValueError:
            return None
    return None


def _como_entero(valor: Any) -> int | None:
    numero = _como_numero(valor)
    return None if numero is None else int(round(numero))


def _como_datetime(valor: Any) -> datetime | None:
    """ISO 8601 de Nexe -> datetime aware en UTC.

    Tolera los dos formatos reales: con microsegundos
    ("2026-06-19T00:37:09.561041Z") y sin ellos ("2026-06-19T00:37:02Z").
    """
    texto = _como_texto(valor)
    if texto is None:
        return None
    normalizado = texto.strip()
    if normalizado.endswith(("Z", "z")):
        normalizado = normalizado[:-1] + "+00:00"
    try:
        momento = datetime.fromisoformat(normalizado)
    except ValueError:
        return None
    # Sin zona explícita, Nexe siempre entrega UTC (CLAUDE.md §14.9).
    if momento.tzinfo is None:
        return momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(timezone.utc)


def _como_fix(valor: Any) -> str | None:
    texto = _como_texto(valor)
    return None if texto is None else _FIX_VALIDOS.get(texto.strip().lower())


def _como_navstate(valor: Any) -> int | None:
    """hgNavstate llega como STRING en el JSON real ("2") — coercionar."""
    entero = _como_entero(valor)
    return entero if entero in _NAVSTATES_VALIDOS else None


def aplanar_feature(feature: Any) -> dict[str, Any] | None:
    """Una feature GeoJSON -> fila plana con nuestras columnas.

    Devuelve None si falta algo esencial (esn, pos_time, latitud, longitud): sin eso
    la posición no es representable ni en el mapa ni en la base.
    """
    if not isinstance(feature, dict):
        return None
    propiedades = feature.get("properties")
    if not isinstance(propiedades, dict):
        return None

    geometria = feature.get("geometry")
    coordenadas = geometria.get("coordinates") if isinstance(geometria, dict) else None
    longitud = latitud = altitud_geom = None
    if isinstance(coordenadas, (list, tuple)) and len(coordenadas) >= 2:
        longitud = _como_numero(coordenadas[0])  # GeoJSON: [longitud, latitud, (alt)]
        latitud = _como_numero(coordenadas[1])
        if len(coordenadas) >= 3:
            altitud_geom = _como_numero(coordenadas[2])

    esn = _como_texto(propiedades.get("esn"))
    pos_time = _como_datetime(propiedades.get("posTime"))
    if esn is None or pos_time is None or latitud is None or longitud is None:
        return None

    # La altitud aún no se ha observado en datos reales (§2 PENDIENTE): se buscan
    # los dos nombres posibles y la 3ª coordenada, por si aparece.
    altitud = _como_numero(propiedades.get("alt"))
    if altitud is None:
        altitud = _como_numero(propiedades.get("altitude"))
    if altitud is None:
        altitud = altitud_geom

    return {
        "esn": esn,
        "pos_time": pos_time,
        # Si no viniera dataCtrTime, usar posTime evita que el cursor retroceda.
        "data_ctr_time": _como_datetime(propiedades.get("dataCtrTime")) or pos_time,
        "latitud": latitud,
        "longitud": longitud,
        "altitud": altitud,
        "velocidad": _como_numero(propiedades.get("spd")),
        "rumbo": _como_entero(propiedades.get("cog")),
        "fix_type": _como_fix(propiedades.get("fix")),
        "src": _como_texto(propiedades.get("src")),
        "pdop": _como_numero(propiedades.get("pdop")),
        "hdop": _como_numero(propiedades.get("hdop")),
        "unit_id": _como_texto(propiedades.get("unitId")),
        "hg_ext_name": _como_texto(propiedades.get("hgExtName")),
        # Metadatos del recurso: presentes solo en get_lastpositions.
        "hg_alias": _como_texto(propiedades.get("hgAlias")),
        "hg_asset": _como_texto(propiedades.get("hgAsset")),
        "hg_asset_model": _como_texto(propiedades.get("hgAssetModel")),
        "hg_asset_family": _como_texto(propiedades.get("hgAssetFamily")),
        "hg_family_type": _como_texto(propiedades.get("hgFamilyType")),
        "hg_company": _como_texto(propiedades.get("hgCompany")),
        "hg_source": _como_texto(propiedades.get("hgSource")),
        "hg_navstate": _como_navstate(propiedades.get("hgNavstate")),
    }


def aplanar_coleccion(cruda: Any) -> tuple[list[dict[str, Any]], int]:
    """FeatureCollection -> (filas aplanadas, cuántas se descartaron)."""
    if not isinstance(cruda, dict):
        return [], 0
    features = cruda.get("features")
    if not isinstance(features, list):
        return [], 0

    filas: list[dict[str, Any]] = []
    descartadas = 0
    for feature in features:
        fila = aplanar_feature(feature)
        if fila is None:
            descartadas += 1
        else:
            filas.append(fila)
    return filas, descartadas


def solo_metadatos(fila: dict[str, Any]) -> dict[str, Any]:
    """Subconjunto de la fila con las columnas de `recurso` (+ esn)."""
    return {"esn": fila["esn"], **{campo: fila.get(campo) for campo in CAMPOS_RECURSO}}


def solo_posicion(fila: dict[str, Any]) -> dict[str, Any]:
    """Subconjunto de la fila con las columnas de `posicion`."""
    return {campo: fila.get(campo) for campo in CAMPOS_POSICION}


def max_data_ctr_time(filas: list[dict[str, Any]]) -> datetime | None:
    """Máximo data_ctr_time de una tanda: el candidato a nuevo cursor (§7.4)."""
    momentos = [f["data_ctr_time"] for f in filas if f.get("data_ctr_time") is not None]
    return max(momentos) if momentos else None
