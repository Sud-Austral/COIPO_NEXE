"""Collector: ingiere Nexe hacia Postgres. ÚNICO consumidor de Nexe del sistema.

Ciclo de una corrida (CLAUDE.md §7.4):

1. Lee el cursor persistido de `estado_ingesta` (o arranca N días atrás la 1ª vez).
2. Pagina `/get` desde ese cursor — el filtro es estrictamente `>` y el límite real
   son 1000 posiciones por respuesta. **Cada página se persiste ANTES de pedir la
   siguiente**: si la corrida se corta a la mitad, lo ya traído queda guardado y el
   cursor apunta exactamente a datos almacenados.
3. Refresca metadatos con `get_lastpositions` (los `hg*` solo llegan ahí) y guarda
   también esas posiciones.
4. Registra el resultado en `estado_ingesta` (visible en /api/estado-ingesta).

El cursor NUNCA retrocede: el UPDATE lo compara con el valor vigente. Un 401 (key
rotada) no lo toca — la ingesta se reanuda sola cuando repongan la key.

Se ejecuta desde `docker-entrypoint.sh` (una corrida inmediata) y luego cada minuto
por supercronic (`collector/crontab`).
"""

from __future__ import annotations

import logging
import sys
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import bootstrap
from app.db.session import SessionLocal, engine
from app.nexe.aplanado import solo_metadatos, solo_posicion
from app.nexe.cliente import (
    ClaveRechazada,
    ClienteNexe,
    ContratoRechazado,
    NexeError,
    iso_utc,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s [collector] %(message)s"
)
logger = logging.getLogger(__name__)


# ── SQL de escritura ─────────────────────────────────────────────────────────

# El dedupe por (esn, pos_time) es la PK: los históricos rezagados y el solapamiento
# de rangos llegan repetidos y se descartan sin costo.
SQL_POSICION = text(
    """
    INSERT INTO posicion (
        esn, pos_time, data_ctr_time, latitud, longitud, altitud, velocidad,
        rumbo, fix_type, src, pdop, hdop, unit_id, hg_ext_name
    ) VALUES (
        :esn, :pos_time, :data_ctr_time, :latitud, :longitud, :altitud, :velocidad,
        :rumbo, :fix_type, :src, :pdop, :hdop, :unit_id, :hg_ext_name
    )
    ON CONFLICT (esn, pos_time) DO NOTHING
    """
)

# COALESCE: un campo que deje de venir no borra el último valor conocido — /get solo
# trae hg_ext_name, así que la mayoría de las filas llegan con el resto en NULL.
SQL_RECURSO = text(
    """
    INSERT INTO recurso (
        esn, unit_id, hg_ext_name, hg_alias, hg_asset, hg_asset_model,
        hg_asset_family, hg_family_type, hg_company, hg_source, hg_navstate
    ) VALUES (
        :esn, :unit_id, :hg_ext_name, :hg_alias, :hg_asset, :hg_asset_model,
        :hg_asset_family, :hg_family_type, :hg_company, :hg_source, :hg_navstate
    )
    ON CONFLICT (esn) DO UPDATE SET
        unit_id         = COALESCE(EXCLUDED.unit_id,         recurso.unit_id),
        hg_ext_name     = COALESCE(EXCLUDED.hg_ext_name,     recurso.hg_ext_name),
        hg_alias        = COALESCE(EXCLUDED.hg_alias,        recurso.hg_alias),
        hg_asset        = COALESCE(EXCLUDED.hg_asset,        recurso.hg_asset),
        hg_asset_model  = COALESCE(EXCLUDED.hg_asset_model,  recurso.hg_asset_model),
        hg_asset_family = COALESCE(EXCLUDED.hg_asset_family, recurso.hg_asset_family),
        hg_family_type  = COALESCE(EXCLUDED.hg_family_type,  recurso.hg_family_type),
        hg_company      = COALESCE(EXCLUDED.hg_company,      recurso.hg_company),
        hg_source       = COALESCE(EXCLUDED.hg_source,       recurso.hg_source),
        hg_navstate     = COALESCE(EXCLUDED.hg_navstate,     recurso.hg_navstate),
        actualizado_en  = now()
    """
)

# GREATEST protege de un retroceso incluso si dos corridas se solaparan.
SQL_AVANZAR_CURSOR = text(
    """
    UPDATE estado_ingesta
    SET cursor_data_ctr_time = GREATEST(
            COALESCE(cursor_data_ctr_time, :cursor), :cursor
        ),
        actualizado_en = now()
    WHERE id = 1
    """
)

SQL_CORRIDA_OK = text(
    """
    UPDATE estado_ingesta
    SET ultima_corrida_en = now(),
        ultima_corrida_ok_en = now(),
        posiciones_ultima_corrida = :posiciones,
        fallos_consecutivos = 0,
        actualizado_en = now()
    WHERE id = 1
    """
)

SQL_CORRIDA_FALLIDA = text(
    """
    UPDATE estado_ingesta
    SET ultima_corrida_en = now(),
        fallos_consecutivos = fallos_consecutivos + 1,
        ultimo_error_en = now(),
        ultimo_error_clase = :clase,
        actualizado_en = now()
    WHERE id = 1
    """
)

SQL_CURSOR_ACTUAL = text(
    "SELECT cursor_data_ctr_time FROM estado_ingesta WHERE id = 1"
)


# ── Persistencia ─────────────────────────────────────────────────────────────


def guardar_filas(db: Session, filas: list[dict]) -> int:
    """Guarda posiciones y metadatos. Devuelve cuántas posiciones se insertaron."""
    if not filas:
        return 0
    insertadas = 0
    for fila in filas:
        resultado = db.execute(SQL_POSICION, solo_posicion(fila))
        insertadas += resultado.rowcount or 0
        db.execute(SQL_RECURSO, solo_metadatos(fila))
    return insertadas


def cursor_persistido(db: Session) -> datetime:
    fila = db.execute(SQL_CURSOR_ACTUAL).first()
    guardado = fila[0] if fila else None
    if guardado is not None:
        return guardado if guardado.tzinfo else guardado.replace(tzinfo=timezone.utc)
    inicio = datetime.now(timezone.utc) - timedelta(days=settings.collector_arranque_dias)
    logger.info(
        "Sin cursor previo: primera ingesta desde %s (%s días atrás)",
        iso_utc(inicio),
        settings.collector_arranque_dias,
    )
    return inicio


# ── Una pasada ───────────────────────────────────────────────────────────────


def una_pasada(api: ClienteNexe, db: Session) -> int:
    """Trae todo lo pendiente y lo guarda. Devuelve posiciones nuevas insertadas."""
    cursor = cursor_persistido(db)
    total = 0

    for numero, pagina in enumerate(
        api.paginas_desde(cursor, max_paginas=settings.collector_max_paginas), start=1
    ):
        nuevas = guardar_filas(db, pagina.filas)
        total += nuevas
        if pagina.cursor is not None:
            db.execute(SQL_AVANZAR_CURSOR, {"cursor": pagina.cursor})
        # Commit por página: lo traído queda firme antes de pedir la siguiente.
        db.commit()
        logger.info(
            "Página %s: %s features, %s nuevas, %s descartadas, cursor -> %s",
            numero,
            pagina.crudas,
            nuevas,
            pagina.descartadas,
            iso_utc(pagina.cursor) if pagina.cursor else "sin cambio",
        )

    # Metadatos hg* y última posición de cada recurso: solo get_lastpositions los trae.
    # No mueve el cursor (sus posiciones pueden ser más viejas que lo ya ingerido).
    desde = datetime.now(timezone.utc) - timedelta(days=settings.collector_lookback_dias)
    ultimas = api.ultimas_posiciones(desde)
    total += guardar_filas(db, ultimas)
    db.commit()
    logger.info("Metadatos refrescados: %s recursos", len(ultimas))

    return total


def corrida() -> int:
    """Una corrida de cron: N pasadas espaciadas dentro del minuto."""
    if not settings.nexe_api_key:
        logger.error(
            "NEXE_API_KEY vacía: el collector no puede ingerir. Revisar el .env del "
            "servidor (guía 8 §2)."
        )
        return 1

    bootstrap.ensure_schema(engine)
    api = ClienteNexe(settings.nexe_base_url, settings.nexe_api_key)

    pasadas = max(1, settings.collector_pasadas_por_minuto)
    espera = 60 / pasadas
    codigo_salida = 0

    for numero in range(1, pasadas + 1):
        db = SessionLocal()
        try:
            nuevas = una_pasada(api, db)
            db.execute(SQL_CORRIDA_OK, {"posiciones": nuevas})
            db.commit()
            logger.info("Pasada %s/%s OK: %s posiciones nuevas", numero, pasadas, nuevas)
        except ClaveRechazada:
            # No se toca el cursor: al reponer la key, la ingesta retoma sola.
            db.rollback()
            _registrar_fallo(db, "ClaveRechazada")
            logger.error(
                "Nexe rechazó la api-key (401). La ingesta queda detenida hasta "
                "reponerla; el cursor NO se movió."
            )
            codigo_salida = 1
        except ContratoRechazado as error:
            db.rollback()
            _registrar_fallo(db, "ContratoRechazado")
            logger.error(
                "Nexe rechazó el body (422): el contrato cambió. Corregir "
                "backend/app/nexe/cliente.py y CLAUDE.md §2. Detalle: %s",
                error.detalle,
            )
            codigo_salida = 1
        except NexeError as error:
            db.rollback()
            _registrar_fallo(db, type(error).__name__)
            logger.warning("Nexe no disponible en esta pasada: %s", error)
            codigo_salida = 1
        except Exception as error:  # base caída, error de esquema…
            db.rollback()
            _registrar_fallo(db, type(error).__name__)
            logger.exception("Fallo inesperado en la pasada %s", numero)
            codigo_salida = 1
        finally:
            db.close()

        if numero < pasadas:
            time.sleep(espera)

    return codigo_salida


def _registrar_fallo(db: Session, clase: str) -> None:
    """Deja el fallo visible en /api/estado-ingesta. Nunca guarda el mensaje crudo."""
    try:
        db.execute(SQL_CORRIDA_FALLIDA, {"clase": clase})
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("No se pudo registrar el fallo en estado_ingesta")


if __name__ == "__main__":
    sys.exit(corrida())
