"""GET /api/exportar — descarga de un rango como GeoJSON o CSV.

Complementa el export del navegador (`frontend/src/lib/exportar.ts`, que baja "lo
visible"): aquí el rango puede ser mucho mayor que lo que el visor tiene cargado, y
sirve para alimentar QGIS/kepler.gl o el análisis en pandas sin pasar por la UI.
"""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import consultas
from ..db.session import get_db
from ..servicios import geojson, tabular
from .comun import validar_rango

router = APIRouter()

LIMITE_POR_DEFECTO = 50_000
LIMITE_MAXIMO = 500_000


@router.get("/api/exportar")
def exportar(
    desde: datetime = Query(...),
    hasta: datetime = Query(...),
    esn: str | None = Query(None),
    formato: str = Query("geojson", pattern="^(geojson|csv)$"),
    limite: int = Query(LIMITE_POR_DEFECTO, ge=1, le=LIMITE_MAXIMO),
    db: Session = Depends(get_db),
) -> Response:
    inicio, fin = validar_rango(desde, hasta)
    filas = consultas.posiciones_por_rango(
        db, desde=inicio, hasta=fin, esn=esn, limite=limite
    )

    marca = inicio.strftime("%Y%m%d") + "-" + fin.strftime("%Y%m%d")
    sufijo = f"_{esn}" if esn else ""

    if formato == "csv":
        # BOM para que Excel abra UTF-8 sin romper los acentos.
        cuerpo = "﻿" + tabular.a_csv(filas)
        return Response(
            content=cuerpo,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="visor-conaf_{marca}{sufijo}.csv"'
                )
            },
        )

    coleccion = geojson.coleccion(
        filas,
        desde=geojson.iso(inicio),
        hasta=geojson.iso(fin),
        truncado=len(filas) >= limite,
    )
    return Response(
        content=json.dumps(coleccion, ensure_ascii=False),
        media_type="application/geo+json",
        headers={
            "Content-Disposition": (
                f'attachment; filename="visor-conaf_{marca}{sufijo}.geojson"'
            )
        },
    )
