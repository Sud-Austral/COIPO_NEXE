"""Serialización a CSV RFC 4180 (para QGIS, Excel y análisis).

Mismo criterio que `frontend/src/lib/exportar.ts`, pero server-side: el navegador no
puede exportar lo que nunca cargó, y un rango de un mes no cabe en su memoria.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Iterable, Mapping

from .geojson import iso

# Encabezados en el vocabulario de Nexe, igual que el export del navegador, para que
# un análisis pueda mezclar archivos de ambas fuentes sin renombrar columnas.
COLUMNAS: tuple[tuple[str, str], ...] = (
    ("esn", "esn"),
    ("hg_ext_name", "hgExtName"),
    ("pos_time", "posTime"),
    ("data_ctr_time", "dataCtrTime"),
    ("latitud", "latitude"),
    ("longitud", "longitude"),
    ("altitud", "altitude"),
    ("velocidad", "speed"),
    ("rumbo", "heading"),
    ("fix_type", "fixType"),
    ("src", "src"),
    ("pdop", "pdop"),
    ("hdop", "hdop"),
    ("unit_id", "unitId"),
    ("hg_alias", "hgAlias"),
    ("hg_asset", "hgAsset"),
    ("hg_asset_model", "hgAssetModel"),
    ("hg_asset_family", "hgAssetFamily"),
    ("hg_family_type", "hgFamilyType"),
    ("hg_company", "hgCompany"),
    ("hg_source", "hgSource"),
    ("hg_navstate", "hgNavstate"),
)

_TEMPORALES = {"pos_time", "data_ctr_time"}


def a_csv(filas: Iterable[Mapping[str, Any]]) -> str:
    """CSV con CRLF y comillas RFC 4180. El BOM lo agrega el endpoint (Excel)."""
    buffer = io.StringIO()
    escritor = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    escritor.writerow([cabecera for _, cabecera in COLUMNAS])
    for fila in filas:
        escritor.writerow(
            [
                iso(fila.get(columna)) if columna in _TEMPORALES else fila.get(columna)
                for columna, _ in COLUMNAS
            ]
        )
    return buffer.getvalue()
