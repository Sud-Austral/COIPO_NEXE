"""Catálogo de la flota: una feature por ESN con su última posición y metadatos.

Reemplaza a `get_lastpositions` de Nexe — y además da el filtro por familia que Nexe
no puede entregar (su parámetro `domain` devuelve 500 en staging, bug escalado;
CLAUDE.md §2).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import consultas
from ..db.session import get_db
from ..servicios import geojson

router = APIRouter()

Familia = Literal["people", "ground", "rotary", "fixed"]


@router.get("/api/recursos")
def listar(
    familia: Familia | None = Query(
        None, description="Familia canónica del activo: people|ground|rotary|fixed."
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    filas = consultas.ultima_posicion_por_recurso(db, familia=familia)
    return geojson.coleccion(filas, recursos=len(filas))


@router.get("/api/recursos/{esn}")
def detalle(esn: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    fila = consultas.recurso_por_esn(db, esn)
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sin posiciones registradas para el ESN {esn}.",
        )
    return geojson.fila_a_feature(fila)
