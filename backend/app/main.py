"""Backend del visor táctico de flota aérea CONAF.

Sirve EXCLUSIVAMENTE desde nuestra base de datos: no habla con Nexe (eso lo hace el
collector). Así el visor sigue funcionando si Nexe se cae, y la api-key vive en un
solo proceso.

Sin CORSMiddleware a propósito: nginx del contenedor `app` sirve el frontend y proxea
`/api` en el MISMO origen, así que el navegador nunca hace una petición cross-origin
(guía 8 §4: si algún día otra app CONAF consume esta API desde un navegador, agregar
una lista explícita de dominios, nunca "*" ni una IP).
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .db import bootstrap
from .db.session import engine
from .routers import estado, exportar, posiciones, recursos, salud

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    problemas = settings.validar_para_produccion()
    if problemas:
        # Abortar el arranque es lo correcto: con estos valores el despliegue queda
        # apuntando a una base de desarrollo o con una clave por defecto.
        for problema in problemas:
            logger.error("Configuración inválida para producción: %s", problema)
        raise RuntimeError(
            "Configuración inválida para producción: " + " | ".join(problemas)
        )
    for aviso in settings.advertencias():
        logger.warning(aviso)

    bootstrap.ensure_schema(engine)
    yield


app = FastAPI(
    title="COIPO_NEXE API",
    description=(
        "Posiciones de la flota aérea de CONAF, servidas desde la base propia "
        "alimentada por el collector desde Nexe (AFF JSON)."
    ),
    lifespan=lifespan,
)

app.include_router(salud.router)
app.include_router(posiciones.router)
app.include_router(recursos.router)
app.include_router(exportar.router)
app.include_router(estado.router)
