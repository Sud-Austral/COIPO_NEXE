"""GET /health — el healthcheck de docker-compose y del smoke test del deploy.

Devuelve 503 `degraded` si la base no responde o el esquema no se aplicó, en vez de
dejar el proceso en crash-loop (guía 8 §9). Nunca filtra el mensaje crudo de
psycopg2: puede traer host y usuario de la base.
"""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from ..db import bootstrap, consultas
from ..db.session import get_db

router = APIRouter()


@router.get("/health")
def health(respuesta: Response, db: Session = Depends(get_db)) -> dict[str, object]:
    problemas: list[str] = []

    try:
        consultas.ping(db)
        base_ok = True
    except Exception as error:
        base_ok = False
        problemas.append(f"base de datos inalcanzable ({type(error).__name__})")

    if not bootstrap.esquema_ok:
        detalle = bootstrap.esquema_error or "sin aplicar"
        problemas.append(
            f"esquema no aplicado ({detalle}); reintentar con "
            "'docker compose restart backend'"
        )

    if problemas:
        respuesta.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "base": base_ok, "problemas": problemas}

    return {"status": "ok", "base": True}
