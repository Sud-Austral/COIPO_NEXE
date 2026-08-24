"""Utilidades compartidas por los routers."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status


def como_utc(momento: datetime) -> datetime:
    """Query param -> datetime aware en UTC.

    Un `datetime` sin zona se interpreta como UTC: el intercambio de la API es
    siempre UTC (CLAUDE.md §14.9) y la conversión a hora de Chile es de presentación.
    """
    if momento.tzinfo is None:
        return momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(timezone.utc)


def validar_rango(desde: datetime, hasta: datetime) -> tuple[datetime, datetime]:
    inicio, fin = como_utc(desde), como_utc(hasta)
    if inicio >= fin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El inicio del rango debe ser anterior al fin.",
        )
    return inicio, fin
