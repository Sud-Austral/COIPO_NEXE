# Docker — cómo está armado y por qué

Este documento explica la arquitectura de contenedores del repo: qué servicios hay, por qué están separados así, y cómo correrlos local. Es la referencia de "cómo debe ser el Docker" para cualquier app de CONAF que siga el mismo patrón de despliegue (self-hosted, servidor compartido + Postgres compartido) — este repo es el ejemplo real y verificado.

Para todo lo que pasa **fuera** de este repo (bootstrap del servidor, Nginx, GitHub Actions, DNS/certificados) ver el repo `COIPO_DOCUMENTO` (Guías 1-6). Esto es solo la parte que vive acá.

---

## Los tres servicios

```
                    ┌─────────────────────────────────────┐
                    │              "app"                    │  ← único con puerto
   Nginx del        │  nginx (interno) + build de React     │    publicado al host
   servidor  ──────►│  proxea /api/ y /health a "backend"   │
   (fuera de        │  por la red interna de Docker         │
   este repo)        └───────────────┬───────────────────────┘
                                      │ http://backend:8000
                                      ▼
                    ┌─────────────────────────────────────┐
                    │             "backend"                 │  ← SIN puerto propio
                    │  FastAPI (uvicorn)                     │
                    └───────────────┬───────────────────────┘
                                      │
                    ┌─────────────────────────────────────┐
                    │            "collector"                │  ← SIN puerto propio
                    │  Node + supercronic (cron interno)     │
                    └───────────────┬───────────────────────┘
                                      │
                                      ▼
                    PostgreSQL 17 compartido (fuera de Docker,
                    administrado aparte — ver .env.example)
```

**`app`** — nginx sirviendo el build de React, y proxeando `/api/` + `/health` al `backend` por la red interna de Docker (`http://backend:8000`, resuelto por el DNS interno de Compose usando el nombre del servicio). Es el **único** servicio con `ports:` — el resto no necesita ser alcanzable desde fuera de Docker.

**`backend`** — FastAPI corriendo con `uvicorn` directo (sin gunicorn: no hace falta, y gunicorn sin la worker class de uvicorn ni siquiera sabría correr una app ASGI). **Sin `ports:` a propósito**: nadie fuera de Docker le habla directo, ni falta que le haga — el servidor ya tiene su propio reverse proxy (Nginx) que solo necesita hablarle a `app`. Menos superficie expuesta, cero funcionalidad perdida. Para depurar puntualmente: `docker compose exec backend curl localhost:8000/health`, o agregar `ports: ["8000:8000"]` temporalmente mientras se investiga.

**`collector`** — el recolector de noticias (Node). Tampoco tiene `ports:` — no es un servicio web. Corre su propio horario **adentro del contenedor** con `supercronic` (un binario de cron para contenedores: sin root, sin syslog, loguea a su propio stdout — visible con `docker compose logs collector`). No depende de ningún cron del servidor: `docker compose up -d` lo deja corriendo como daemon, y el horario (`collector/crontab`) viaja con la imagen, no con la configuración de la máquina donde se despliegue. Tampoco tiene `depends_on` hacia `backend`: solo habla con Postgres directo, una dependencia hacia el backend sería artificial.

**La base de datos no está en este `docker-compose.yml`**: es un Postgres 17 compartido entre todas las apps de CONAF, administrado en otro servidor. Este repo solo se conecta a él (variables en `.env`).

---

## `docker-compose.yml` (producción)

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    env_file: .env
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 15s
    restart: unless-stopped

  collector:
    build:
      context: .
      dockerfile: collector/Dockerfile
    env_file: .env
    volumes:
      - collector_datos:/app/collector/datos
    restart: unless-stopped

  app:
    build:
      context: .
      dockerfile: frontend/Dockerfile
      args:
        BASE_PATH: /
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "${APP_PORT:-8080}:8000"
    restart: unless-stopped

volumes:
  collector_datos:
```

Notas de diseño:

- **`context: .` en los tres, no `./backend`/`./collector`/`./frontend`**: cada Dockerfile necesita copiar cosas de fuera de su propia carpeta (`backend/Dockerfile` copia `db/schema.sql`; `collector/Dockerfile` también) — con el *build context* en la raíz, cualquier Dockerfile del repo puede `COPY` desde cualquier ruta relativa a la raíz.
- **`depends_on: backend: condition: service_healthy`** en `app`: no alcanza con que el contenedor de `backend` exista, tiene que estar realmente respondiendo `/health` antes de que `app` (que depende de él para todo) arranque a recibir tráfico.
- **`collector_datos` como volumen con nombre**: el estado de trabajo del collector (deduplicación, cachés de fuentes) debe sobrevivir a que el contenedor se reinicie o se reconstruya en cada deploy — si viviera solo dentro del contenedor, se perdería en cada `docker compose up --build`.

---

## `docker-compose.dev.yml` (desarrollo local, sin tocar el Postgres compartido)

```yaml
services:
  postgres-dev:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${DATABASE_USER:-coipo}
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-coipo}
      POSTGRES_DB: ${DATABASE_NAME:-coipo_prensa}
    ports:
      - "5432:5432"
    volumes:
      - postgres_dev_datos:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DATABASE_USER:-coipo} -d ${DATABASE_NAME:-coipo_prensa}"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    depends_on:
      postgres-dev:
        condition: service_healthy
    ports:
      - "${BACKEND_PORT:-8000}:8000"   # solo en dev — en prod backend no publica puerto

  collector:
    depends_on:
      postgres-dev:
        condition: service_healthy

volumes:
  postgres_dev_datos:
```

Es un **override** (Compose combina los dos archivos), no un compose independiente — agrega un Postgres desechable y le suma `depends_on`/`ports` extra a los servicios que ya existen en el archivo base, sin duplicar `build:` ni el resto. Uso:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev up --build
```

`.env.dev` debe tener `DATABASE_HOST=postgres-dev` (el nombre del servicio, no una IP — de nuevo, DNS interno de Compose).

---

## `.env` / `.env.example`

```
DATABASE_HOST=172.31.2.40
DATABASE_PORT=5432
DATABASE_USER=
DATABASE_PASSWORD=
DATABASE_NAME=

APP_PORT=8080

# Solo dev:
BACKEND_PORT=8000
```

Cinco variables de conexión separadas (no una `DATABASE_URL` única) porque así las lee `backend/app/config.py` — sigue el patrón de `fastapi-postgresql-conexion.md`. `APP_PORT` es el único puerto que le importa a producción (el que el Nginx del servidor necesita conocer). `BACKEND_PORT` no tiene ningún efecto en producción — solo lo usa `docker-compose.dev.yml` para poder `curl`/depurar el backend directo desde el host mientras se desarrolla.

**El `.env` real (con la clave de verdad) nunca se commitea** — está en `.gitignore`. En producción lo crea el bootstrap del servidor (`COIPO_DOCUMENTO`, Guía 1 §4), no este repo.

---

## Comandos comunes

```bash
# Producción (o "como si fuera producción" local, con el Postgres compartido real)
docker compose --env-file .env up --build -d

# Desarrollo, con Postgres local desechable
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev up --build

# Logs de un servicio
docker compose logs -f backend
docker compose logs -f collector    # acá se ven las corridas de supercronic

# Reiniciar solo uno (ej. tras arreglar pg_hba.conf del lado del servidor)
docker compose restart backend

# Estado
docker ps
```

## Errores comunes

| Síntoma | Causa |
|---|---|
| `/health` responde `Internal Server Error` genérico tras arreglar algo de la BD | El `backend` ya había fallado al crear el esquema (`db/schema.sql`) al arrancar y no reintenta solo por diseño (ver `backend/app/db/bootstrap.py`) — `docker compose restart backend` |
| `app` no encuentra a `backend` | Ambos deben estar en el mismo `docker-compose.yml` — la red interna de Docker resuelve por nombre de servicio (`http://backend:8000`), no por IP fija |
| El `collector` no escribe nada | Revisa `docker compose logs collector` — `supercronic` loguea cada corrida ahí; el cron real vive en `collector/crontab`, offset `:17` para no coincidir con la estampida del segundo 0 de cada hora |
| Cambié algo y no se refleja | `docker compose up --build` (no solo `up`) para forzar la reconstrucción de la imagen |
