"""Posiciones: modo vivo (incremental por cursor) y modo histórico (rango libre).

Ambos devuelven GeoJSON FeatureCollection con el vocabulario de Nexe, así que el
parser del frontend (`frontend/src/api/parse.ts`) los consume sin cambios.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import consultas
from ..db.session import get_db
from ..servicios import geojson
from .comun import como_utc, validar_rango

router = APIRouter()

LIMITE_INCREMENTAL_POR_DEFECTO = 1000
LIMITE_INCREMENTAL_MAXIMO = 5000
LIMITE_RANGO_POR_DEFECTO = 5000
LIMITE_RANGO_MAXIMO = 20000


@router.get("/api/posiciones/incremental")
def incremental(
    cursor: datetime = Query(
        ...,
        description="Trae todo lo llegado al servidor DESPUÉS (>) de esta fecha, ISO UTC.",
    ),
    limite: int = Query(
        LIMITE_INCREMENTAL_POR_DEFECTO, ge=1, le=LIMITE_INCREMENTAL_MAXIMO
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Modo vivo. `siguienteCursor` es el cursor a usar en la próxima llamada.

    A diferencia de Nexe, aquí el servidor calcula el cursor: el cliente no tiene que
    recorrer las posiciones para sacar el máximo `dataCtrTime`. `hayMas` avisa que la
    tanda salió tope y conviene volver a pedir de inmediato en vez de esperar el
    siguiente ciclo (equivale a la paginación que antes hacía el navegador).
    """
    desde = como_utc(cursor)
    filas = consultas.posiciones_incremental(db, cursor=desde, limite=limite)

    ultimo = filas[-1]["data_ctr_time"] if filas else None
    return geojson.coleccion(
        filas,
        siguienteCursor=geojson.iso(ultimo) if ultimo else geojson.iso(desde),
        hayMas=len(filas) >= limite,
    )


@router.get("/api/posiciones")
def por_rango(
    desde: datetime = Query(..., description="Inicio del rango (pos_time), ISO UTC."),
    hasta: datetime = Query(..., description="Fin del rango (pos_time), ISO UTC."),
    esn: str | None = Query(None, description="Limitar a un recurso."),
    limite: int = Query(LIMITE_RANGO_POR_DEFECTO, ge=1, le=LIMITE_RANGO_MAXIMO),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Modo histórico: una sola consulta, sin paginar en el navegador.

    Filtra por `pos_time` (cuándo estuvo ahí la aeronave), no por `dataCtrTime`
    (cuándo llegó el dato): es lo que espera quien pide "las trazas del martes".
    """
    inicio, fin = validar_rango(desde, hasta)
    filas = consultas.posiciones_por_rango(
        db, desde=inicio, hasta=fin, esn=esn, limite=limite
    )
    return geojson.coleccion(
        filas,
        desde=geojson.iso(inicio),
        hasta=geojson.iso(fin),
        truncado=len(filas) >= limite,
    )
