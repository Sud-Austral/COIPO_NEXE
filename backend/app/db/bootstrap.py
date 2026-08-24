"""Bootstrap idempotente del esquema.

`db/schema.sql` (raíz del repo) es la ÚNICA fuente de verdad del DDL: lo ejecutan tal
cual el backend (aquí, al arrancar) y el collector (`collector/ingesta.py`). No
agregar `Base.metadata.create_all()` en ningún lado.

NO lanza si falla: se loguea y la app sigue viva, y `/health` responde 503 `degraded`
en vez de dejar el contenedor en crash-loop por un problema transitorio de red hacia
el Postgres compartido. Tras arreglar la causa: `docker compose restart backend`.
"""

import logging
import os
from pathlib import Path

from sqlalchemy import Engine

logger = logging.getLogger(__name__)

# Debe coincidir con el encabezado de db/schema.sql. Arbitraria y propia de esta app:
# backend y collector arrancan a la vez y crearían las tablas en paralelo.
CANDADO_ESQUEMA = 729154033

# backend/app/db/bootstrap.py -> parents[3] es la raíz del repo (mismo layout
# relativo dentro y fuera de Docker, ver backend/Dockerfile).
RUTA_ESQUEMA_POR_DEFECTO = Path(__file__).resolve().parents[3] / "db" / "schema.sql"

# Estado observable por /health (routers/salud.py). No se expone el mensaje crudo de
# psycopg2 al cliente: puede traer el host/usuario de la base.
esquema_ok: bool = False
esquema_error: str | None = None


def _ruta_esquema() -> Path:
    override = os.getenv("SCHEMA_SQL_PATH")
    return Path(override) if override else RUTA_ESQUEMA_POR_DEFECTO


def ensure_schema(engine: Engine) -> None:
    global esquema_ok, esquema_error
    ruta = _ruta_esquema()
    try:
        sql = ruta.read_text(encoding="utf-8")
        with engine.connect() as conexion:
            conexion.exec_driver_sql(f"SELECT pg_advisory_lock({CANDADO_ESQUEMA})")
            try:
                # Sin parámetros: psycopg2 admite varias sentencias `;`-separadas en
                # una sola llamada (protocolo simple).
                conexion.exec_driver_sql(sql)
                conexion.commit()
            finally:
                conexion.exec_driver_sql(f"SELECT pg_advisory_unlock({CANDADO_ESQUEMA})")
        esquema_ok, esquema_error = True, None
        logger.info("Esquema de Postgres verificado/creado (%s)", ruta)
    except Exception as error:
        esquema_ok = False
        esquema_error = type(error).__name__
        logger.exception("No se pudo verificar/crear el esquema de Postgres al arrancar")
