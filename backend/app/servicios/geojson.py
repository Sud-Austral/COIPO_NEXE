"""Filas de Postgres -> GeoJSON FeatureCollection con el vocabulario de Nexe.

Decisión de diseño (plan de migración): nuestra API conserva la FORMA de respuesta de
Nexe — FeatureCollection con `esn`/`posTime`/`dataCtrTime`/`cog`/`spd`/`fix`/`hg*` —
aunque abandona su forma de PETICIÓN (GET con query params, no el body `dataRequest`).
Así `frontend/src/api/parse.ts` y sus tests siguen valiendo sin cambios, y el export
GeoJSON del navegador es exactamente el mismo payload.

`coordinates` va en orden GeoJSON [longitud, latitud].
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

# Propiedades que solo tienen sentido si el recurso tiene metadatos (get_lastpositions).
_METADATOS = {
    "unit_id": "unitId",
    "hg_ext_name": "hgExtName",
    "hg_alias": "hgAlias",
    "hg_asset": "hgAsset",
    "hg_asset_model": "hgAssetModel",
    "hg_asset_family": "hgAssetFamily",
    "hg_family_type": "hgFamilyType",
    "hg_company": "hgCompany",
    "hg_source": "hgSource",
}

_TELEMETRIA = {
    "rumbo": "cog",
    "velocidad": "spd",
    "fix_type": "fix",
    "src": "src",
    "pdop": "pdop",
    "hdop": "hdop",
    "altitud": "alt",
}


def iso(momento: datetime | None) -> str | None:
    """datetime -> ISO 8601 UTC con MICROSEGUNDOS y Z.

    Los microsegundos importan: `dataCtrTime` es el cursor de la ingesta y del modo
    vivo. Truncar podría hacer que un cliente vuelva a pedir el mismo registro (algo
    inocuo, el dedupe lo absorbe) pero redondear hacia arriba se saltaría posiciones.
    """
    if momento is None:
        return None
    if momento.tzinfo is None:
        momento = momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def fila_a_feature(fila: Mapping[str, Any]) -> dict[str, Any]:
    propiedades: dict[str, Any] = {
        "esn": fila["esn"],
        "posTime": iso(fila.get("pos_time")),
        "dataCtrTime": iso(fila.get("data_ctr_time")),
    }

    for columna, clave in _TELEMETRIA.items():
        valor = fila.get(columna)
        if valor is not None:
            propiedades[clave] = valor

    for columna, clave in _METADATOS.items():
        valor = fila.get(columna)
        if valor is not None:
            propiedades[clave] = valor

    # Nexe manda hgNavstate como string ("2"); nuestro parser tolera ambos y aquí se
    # emite como número, que es lo honesto en JSON.
    if fila.get("hg_navstate") is not None:
        propiedades["hgNavstate"] = fila["hg_navstate"]

    return {
        "type": "Feature",
        "properties": propiedades,
        "geometry": {
            "type": "Point",
            "coordinates": [fila["longitud"], fila["latitud"]],
        },
    }


def coleccion(
    filas: Iterable[Mapping[str, Any]], **extras: Any
) -> dict[str, Any]:
    """FeatureCollection. `extras` viaja en la raíz (GeoJSON admite miembros ajenos,
    igual que el `dataInfo` de Nexe); el parser del frontend los ignora."""
    cuerpo: dict[str, Any] = {
        "type": "FeatureCollection",
        "dataInfo": [
            {
                "affVer": "json 1.0",
                "provider": "COIPO_NEXE",  # nuestra base, no Nexe directo
                "rptTime": iso(datetime.now(timezone.utc)),
            }
        ],
    }
    cuerpo.update({k: v for k, v in extras.items() if v is not None})
    cuerpo["features"] = [fila_a_feature(f) for f in filas]
    return cuerpo
