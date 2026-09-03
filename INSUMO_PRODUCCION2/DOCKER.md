# Docker — cómo está armado y por qué

Este documento explica la arquitectura de contenedores: qué servicios hay, por qué están separados así, y cómo correrlos local. Es la referencia de "cómo debe ser el Docker" para cualquier app de CONAF que siga el patrón de despliegue (self-hosted, servidor compartido + Postgres compartido).

Para todo lo que pasa **fuera** del repo de la app (bootstrap del servidor, Nginx, GitHub Actions, DNS/certificados) ver `COIPO_DOCUMENTO` (Guías 1-6) y el `README.md` de `infra-docker-base`.

> **Cambios respecto a la versión anterior** (verificados contra vm2 y vm3 el 2026-08-20):
> versiones reales de Docker/Compose/Postgres, la sección nueva sobre qué llega al servidor
> tras anclar los `--exclude` del `rsync`, la limpieza de la caché de build, y una nota
> honesta sobre en qué se aparta la flota real de este patrón.
> Detalle en `00-HALLAZGOS-Y-ESTADO-REAL.md`.

---

## Versiones reales del entorno

| | vm2 (producción) | vm3 (UAT) |
|---|---|---|
| Docker | 29.6.2 | 29.7.2 |
| Docker Compose | v5.3.1 | v5.4.0 |
| SO | Ubuntu 24.04.2 LTS | Ubuntu 24.04.2 LTS |

PostgreSQL compartido: **17.10** en `172.31.2.40:5432`, fuera de Docker.

vm3 va por delante de vm2. Es poco, pero significa que UAT no valida exactamente el mismo runtime que producción; tenlo presente antes de concluir "en UAT funcionaba".

---

## Los tres servicios

```
                    ┌──────────────────────────────────────┐
                    │                "app"                  │  ← único con puerto
   Nginx del        │  nginx (interno) + build de React     │    publicado al host
   servidor  ──────►│  proxea /api/ y /health a "backend"   │
   (fuera de        │  por la red interna de Docker         │
   este repo)       └───────────────┬──────────────────────┘
                                    │ http://backend:8000
                                    ▼
                    ┌──────────────────────────────────────┐
                    │              "backend"                │  ← SIN puerto propio
                    │  FastAPI (uvicorn)                    │
                    └───────────────┬──────────────────────┘
                                    │
                    ┌──────────────────────────────────────┐
                    │             "collector"               │  ← SIN puerto propio
                    │  Node + supercronic (cron interno)    │
                    └───────────────┬──────────────────────┘
                                    │
                                    ▼
                    PostgreSQL 17.10 compartido, fuera de Docker
                    (172.31.2.40:5432 — ver .env.example)
```

**`app`** — nginx sirviendo el build de React y proxeando `/api/` + `/health` al `backend` por la red interna de Docker (`http://backend:8000`, resuelto por el DNS interno de Compose usando el nombre del servicio). Es el **único** servicio con `ports:`: el resto no necesita ser alcanzable desde fuera de Docker.

**`backend`** — FastAPI con `uvicorn` directo (sin gunicorn: no hace falta, y gunicorn sin la worker class de uvicorn ni siquiera sabría correr una app ASGI). **Sin `ports:` a propósito**: nadie fuera de Docker le habla directo — el servidor ya tiene su reverse proxy, que solo necesita hablarle a `app`. Menos superficie expuesta, cero funcionalidad perdida. Para depurar: `docker compose exec backend curl localhost:8000/health`, o agregar `ports: ["8000:8000"]` temporalmente.

**`collector`** — recolector (Node). Tampoco tiene `ports:`, no es un servicio web. Corre su horario **adentro del contenedor** con `supercronic` (cron para contenedores: sin root, sin syslog, loguea a stdout — visible con `docker compose logs collector`). No depende de ningún cron del servidor, y el horario (`collector/crontab`) viaja con la imagen, no con la máquina. Tampoco tiene `depends_on` hacia `backend`: solo habla con Postgres, la dependencia sería artificial.

**La base de datos no está en el `docker-compose.yml`**: es un Postgres compartido entre todas las apps, administrado aparte. El repo solo se conecta (variables en `.env`).

### En qué se aparta la flota real de este patrón

Revisados los nueve `docker-compose.yml` de vm2, hay dos excepciones que conviene conocer para no "corregirlas" a ciegas:

- `coipo_archivo` no declara **ningún** `healthcheck:`.
- `coipo_prensa2` tiene **tres** bloques `ports:`, no uno.

Ninguna está rota. Pero el patrón de arriba describe el ideal, no el censo.

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

- **Sin clave `version:`.** Está obsoleta desde Compose v2 y ninguna app de la flota la usa ya. Si la ves en un ejemplo viejo, bórrala.
- **`context: .` en los tres**, no `./backend`/`./collector`/`./frontend`: cada Dockerfile necesita copiar cosas de fuera de su propia carpeta (`backend/Dockerfile` copia `db/schema.sql`) — con el *build context* en la raíz, cualquier Dockerfile puede `COPY` desde cualquier ruta relativa a la raíz. **Contrapartida:** el contexto es el repo entero, así que conviene un `.dockerignore` en la raíz excluyendo lo que ninguna imagen usa (`mobile/`, `node_modules`, `.git`). Sin él, cada build sube decenas de MB al daemon.
- **`depends_on: condition: service_healthy`** en `app`: no alcanza con que el contenedor de `backend` exista, tiene que estar respondiendo `/health` antes de que `app` arranque a recibir tráfico.
- **`collector_datos` como volumen con nombre**: el estado de trabajo del collector (deduplicación, cachés) debe sobrevivir a que el contenedor se reconstruya en cada deploy.
- **El `healthcheck` y el `/health` tienen que apuntar al mismo sitio.** Si el `test:` mira otra ruta u otro puerto, el contenedor queda `unhealthy` para siempre sin que nada se rompa — y ese `unhealthy` permanente esconderá un problema real el día que lo haya. Está pasando hoy con `coipo_cabania`: `unhealthy` desde hace 8 días, mientras su `/health` devuelve 200.

---

## Estado persistente: dónde puede vivir

El despliegue sincroniza el repo al servidor con `rsync -a --delete` y tres exclusiones **ancladas a la raíz**: `/.git`, `/.env`, `/data/`.

- El **único** directorio protegido de `--delete` es `data/` **en la raíz** del repo. Ahí deben apuntar los bind-mounts de estado.
- Un `data/` **anidado** (`frontend/src/data/`, `backend/app/data/`) se sincroniza y se borra como cualquier otro directorio. No lo uses para estado.
- Lo que commitees **dentro** de `data/` de la raíz nunca llega al servidor: está excluido en los dos sentidos.
- Un archivo generado en runtime fuera de `data/` se pierde en el siguiente despliegue.
- Los **volúmenes con nombre** (como `collector_datos`) viven en el área de Docker, no en `/opt/apps/<app>/`, así que el `rsync` no los toca en absoluto. Es la opción más segura para estado que no necesitas inspeccionar a mano.

Hasta agosto de 2026 los patrones iban sin anclar y casaban a cualquier profundidad. Como `--delete` tampoco borra lo excluido, un catálogo versionado bajo `frontend/src/data/` quedó **congelado** meses en el servidor mientras el resto del repo se actualizaba, y la app arrancó sana con la base vacía.

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

Es un **override** (Compose combina los dos archivos), no un compose independiente: agrega un Postgres desechable y le suma `depends_on`/`ports` a los servicios que ya existen en el archivo base, sin duplicar `build:`. Uso:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev up --build
```

`.env.dev` debe tener `DATABASE_HOST=postgres-dev` (el nombre del servicio, no una IP — DNS interno de Compose). La imagen `postgres:17-alpine` coincide en mayor con el servidor real (17.10); si el servidor sube de mayor, actualízala también.

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

Cinco variables de conexión separadas (no una `DATABASE_URL` única) porque así las lee `backend/app/config.py` — sigue el patrón de `fastapi-postgresql-conexion.md`.

**`APP_PORT` debe ser único en la VM.** El `8080` de arriba es solo el default del template: la asignación real está en `00-HALLAZGOS-Y-ESTADO-REAL.md` §2. Si dos apps comparten puerto, el smoke test de una puede dar verde contra el `/health` de la otra.

`BACKEND_PORT` no tiene ningún efecto en producción — solo lo usa `docker-compose.dev.yml`.

**El `.env` real nunca se commitea** — está en `.gitignore`, y en producción lo crea el bootstrap del servidor. Ojo con la forma de escribirlo: el smoke test extrae el puerto con `grep '^APP_PORT=' .env | cut -d= -f2`, así que comillas (`APP_PORT="8080"`), espacios alrededor del `=` o finales de línea CRLF rompen la URL del `curl` de forma poco evidente.

Y desde que los excludes están anclados: **un `.env` versionado en un subdirectorio (`web/.env`) sí llega al servidor**. Antes no llegaba. Revísalo antes del primer push.

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
docker compose ps
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

`docker-compose` con guion (v1) está descontinuado: usar siempre `docker compose`.

---

## Mantenimiento del disco (esto no lo hace el despliegue)

El workflow ejecuta `docker image prune -f` al final de cada despliegue, que borra imágenes *dangling* — pero **no toca la caché de BuildKit**, que crece sin techo. Medido en vm2: **19,31 GB de caché de build, 15,44 GB recuperables**, con el disco al 56 %.

```bash
df -h /opt && docker system df        # ver el panorama
docker builder prune -f               # liberar caché de build (lo que falta)
docker image prune -a -f              # agresivo: borra imágenes sin contenedor asociado
```

`docker image prune -a` y `docker builder prune` afectan a **todas** las apps de la VM, no solo a la que estás mirando. El siguiente build de cada app será más lento porque reconstruye capas. Conviene hacerlo como tarea periódica documentada, no dentro del workflow.

---

## Errores comunes

| Síntoma | Causa |
|---|---|
| `/health` responde `Internal Server Error` genérico tras arreglar algo de la BD | El `backend` ya había fallado al crear el esquema al arrancar y no reintenta solo por diseño — `docker compose restart backend` |
| `app` no encuentra a `backend` | Ambos deben estar en el mismo `docker-compose.yml` — la red interna resuelve por nombre de servicio (`http://backend:8000`), no por IP fija |
| El `collector` no escribe nada | `docker compose logs collector` — `supercronic` loguea cada corrida ahí; el cron vive en `collector/crontab` |
| Cambié algo y no se refleja | `docker compose up --build` (no solo `up`) para forzar la reconstrucción |
| El contenedor está `Up` pero `unhealthy` desde hace días | El `test:` del healthcheck no apunta donde el `/health` real. Reproducilo a mano: `docker compose exec backend python -c "..."` con el mismo comando del `test:` |
| El deploy salió verde pero un archivo del repo no cambió en el servidor | Ver `docs/RUNBOOK.md` de `infra-docker-base`, paso 3 |
| `No space left on device` en el build | Caché de BuildKit — ver la sección de mantenimiento de arriba |
