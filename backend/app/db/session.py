"""Sesión síncrona de SQLAlchemy (psycopg2).

Pool conservador: 172.31.2.40 es un Postgres compartido entre todas las apps de
CONAF que no administramos nosotros. `gssencmode`/`sslmode` en disable y
`connect_timeout` según INSUMO_PRODUCCION/fastapi-postgresql-conexion.md (sin
gssencmode disable, psycopg2 falla con "could not initiate GSSAPI security context").
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..config import settings

engine = create_engine(
    settings.sqlalchemy_database_url,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    connect_args={
        "connect_timeout": 10,
        "gssencmode": "disable",
        "sslmode": "disable",
    },
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
