"""Consultas de LECTURA sobre Postgres (SQL explícito, sin ORM).

No hay modelos SQLAlchemy declarativos a propósito: `db/schema.sql` es la única
autoridad del esquema (ver bootstrap.py) y estas consultas son proyecciones puntuales
para la API. Un ORM aquí solo agregaría una segunda definición del esquema que puede
desincronizarse.

Todas devuelven listas de dicts con nombres de columna del esquema; la traducción al
vocabulario de Nexe ocurre en `app/servicios/geojson.py`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# Columnas de telemetría comunes a todas las proyecciones de `posicion`.
_TELEMETRIA = """
    p.esn, p.pos_time, p.data_ctr_time, p.latitud, p.longitud,
    p.altitud, p.velocidad, p.rumbo, p.fix_type, p.src, p.pdop, p.hdop
"""

# `recurso` puede no tener fila todavía (un ESN visto solo por /get): los metadatos
# caen a lo que trajo la propia posición.
_METADATOS = """
    COALESCE(r.unit_id, p.unit_id)         AS unit_id,
    COALESCE(r.hg_ext_name, p.hg_ext_name) AS hg_ext_name,
    r.hg_alias, r.hg_asset, r.hg_asset_model, r.hg_asset_family,
    r.hg_family_type, r.hg_company, r.hg_source, r.hg_navstate
"""


def _filas(resultado) -> list[dict[str, Any]]:
    return [dict(fila) for fila in resultado.mappings()]


def posiciones_incremental(
    db: Session, *, cursor: datetime, limite: int
) -> list[dict[str, Any]]:
    """Modo vivo: todo lo llegado al servidor DESPUÉS (>) del cursor.

    Ordenado por data_ctr_time para que el cliente pueda tomar el último como
    siguiente cursor sin perder registros intermedios cuando se topa con el límite.
    """
    sql = text(
        f"""
        SELECT {_TELEMETRIA}, p.unit_id, p.hg_ext_name
        FROM posicion p
        WHERE p.data_ctr_time > :cursor
        ORDER BY p.data_ctr_time ASC, p.esn ASC
        LIMIT :limite
        """
    )
    return _filas(db.execute(sql, {"cursor": cursor, "limite": limite}))


def posiciones_por_rango(
    db: Session,
    *,
    desde: datetime,
    hasta: datetime,
    esn: str | None = None,
    limite: int,
) -> list[dict[str, Any]]:
    """Modo histórico: rango libre por pos_time (la hora real de la posición)."""
    sql = text(
        f"""
        SELECT {_TELEMETRIA}, p.unit_id, p.hg_ext_name
        FROM posicion p
        WHERE p.pos_time >= :desde
          AND p.pos_time <= :hasta
          AND (:esn IS NULL OR p.esn = :esn)
        ORDER BY p.esn ASC, p.pos_time ASC
        LIMIT :limite
        """
    )
    return _filas(
        db.execute(sql, {"desde": desde, "hasta": hasta, "esn": esn, "limite": limite})
    )


def ultima_posicion_por_recurso(
    db: Session, *, familia: str | None = None
) -> list[dict[str, Any]]:
    """Una fila por ESN con su última posición + metadatos: reemplaza get_lastpositions.

    DISTINCT ON aprovecha idx_posicion_esn_pos_time; con ~11 recursos es inmediato
    incluso con millones de filas.
    """
    sql = text(
        f"""
        SELECT DISTINCT ON (p.esn) {_TELEMETRIA}, {_METADATOS}
        FROM posicion p
        LEFT JOIN recurso r ON r.esn = p.esn
        WHERE (:familia IS NULL OR r.hg_family_type = :familia)
        ORDER BY p.esn ASC, p.pos_time DESC
        """
    )
    return _filas(db.execute(sql, {"familia": familia}))


def recurso_por_esn(db: Session, esn: str) -> dict[str, Any] | None:
    sql = text(
        f"""
        SELECT {_TELEMETRIA}, {_METADATOS}
        FROM posicion p
        LEFT JOIN recurso r ON r.esn = p.esn
        WHERE p.esn = :esn
        ORDER BY p.pos_time DESC
        LIMIT 1
        """
    )
    filas = _filas(db.execute(sql, {"esn": esn}))
    return filas[0] if filas else None


def estado_ingesta(db: Session) -> dict[str, Any] | None:
    sql = text(
        """
        SELECT cursor_data_ctr_time, ultima_corrida_en, ultima_corrida_ok_en,
               posiciones_ultima_corrida, fallos_consecutivos,
               ultimo_error_en, ultimo_error_clase, actualizado_en
        FROM estado_ingesta
        WHERE id = 1
        """
    )
    filas = _filas(db.execute(sql))
    return filas[0] if filas else None


def resumen(db: Session) -> dict[str, Any]:
    """Cifras para /api/estado-ingesta: tamaño real de lo acumulado."""
    sql = text(
        """
        SELECT count(*) AS posiciones,
               count(DISTINCT esn) AS recursos,
               min(pos_time) AS primera_posicion,
               max(pos_time) AS ultima_posicion
        FROM posicion
        """
    )
    return _filas(db.execute(sql))[0]


def ping(db: Session) -> None:
    """Comprobación de conectividad para /health."""
    db.execute(text("SELECT 1"))
