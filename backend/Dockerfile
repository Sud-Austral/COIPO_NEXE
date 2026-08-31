# Backend FastAPI. Build context = RAÍZ del repo (ver docker-compose.yml): necesita
# copiar db/schema.sql, que vive fuera de backend/.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# El mismo layout relativo que en el repo: backend/app/db/bootstrap.py resuelve
# parents[3]/db/schema.sql tanto dentro como fuera del contenedor.
COPY db/ db/
COPY backend/ backend/

WORKDIR /app/backend
EXPOSE 8000

# uvicorn directo, sin gunicorn: es una app ASGI y gunicorn sin la worker class de
# uvicorn no sabría correrla. 2 workers porque el Postgres es compartido y no
# conviene multiplicar conexiones.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
