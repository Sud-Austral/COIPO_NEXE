# Conexión FastAPI → PostgreSQL

**Servidor:** 172.31.2.40:5432
**Base de datos:** PostgreSQL **17.10** (verificado con `select version()` el 2026-08-20)
**Esquema:** public

> **Cambios respecto a la versión anterior.** Los ejemplos síncronos estaban escritos para
> SQLAlchemy 1.x y **fallan** en SQLAlchemy 2.x, que es lo que instala hoy un
> `pip install sqlalchemy`: pasar un string crudo a `db.execute()` ya no está permitido.
> También se corrigió el `sessionmaker` async, se quitó la clave `version:` obsoleta del
> ejemplo de Compose, se cambió `docker-compose` por `docker compose`, y se añadió la
> sección sobre `/health`, que es donde un fallo de datos se disfraza de app sana.

---

## Parámetros de conexión

```
Host: 172.31.2.40
Puerto: 5432
Usuario: <tu_usuario>
Contraseña: <tu_contraseña>
Base de datos: <tu_base>
sslmode: disable
gssencmode: disable
```

`sslmode=disable` y `gssencmode=disable` no son descuido: la conexión va por la red interna
de CONAF y sin ellos `psycopg2` intenta negociar GSSAPI primero, lo que en este servidor
falla con un error poco descriptivo (ver *Troubleshooting*).

---

## Instalación

```bash
pip install fastapi uvicorn "psycopg[binary]" sqlalchemy
# o para async:
pip install fastapi uvicorn asyncpg sqlalchemy
```

`psycopg2-binary` sigue funcionando, pero para proyectos nuevos conviene `psycopg` (v3):
está mantenido y es el que recomienda SQLAlchemy 2.x. Si usás psycopg v3, la URL es
`postgresql+psycopg://...`; con psycopg2, `postgresql://...` a secas.

---

## Configuración mínima

### Variables de entorno

```ini
# .env
DATABASE_HOST=172.31.2.40
DATABASE_PORT=5432
DATABASE_USER=<usuario>
DATABASE_PASSWORD=<contraseña>
DATABASE_NAME=<base>
```

El `.env` real nunca se commitea: en producción lo crea el bootstrap del servidor.

### SQLAlchemy (síncrono)

```python
# config.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = (
    f"postgresql://"
    f"{os.getenv('DATABASE_USER')}:"
    f"{os.getenv('DATABASE_PASSWORD')}@"
    f"{os.getenv('DATABASE_HOST')}:"
    f"{os.getenv('DATABASE_PORT')}/"
    f"{os.getenv('DATABASE_NAME')}"
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # ver nota abajo
    pool_recycle=1800,
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
```

**`pool_pre_ping=True` y `pool_recycle` no son opcionales aquí.** El Postgres es compartido
y está en otra máquina: cortes de red, reinicios del servidor o timeouts del lado de la base
dejan conexiones muertas en el pool. Sin `pool_pre_ping`, la app las reutiliza y devuelve
errores intermitentes de "server closed the connection unexpectedly" que solo se arreglan
reiniciando el contenedor.

### SQLAlchemy (async)

```python
# config.py (async)
import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = (
    f"postgresql+asyncpg://"
    f"{os.getenv('DATABASE_USER')}:"
    f"{os.getenv('DATABASE_PASSWORD')}@"
    f"{os.getenv('DATABASE_HOST')}:"
    f"{os.getenv('DATABASE_PORT')}/"
    f"{os.getenv('DATABASE_NAME')}"
)

async_engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args={"timeout": 10},
)

AsyncSessionLocal = async_sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

Dos correcciones respecto al ejemplo anterior:

- **`async_sessionmaker`**, no `sessionmaker(...)`. Desde SQLAlchemy 2.0 hay una fábrica
  propia para sesiones async; usar la síncrona funciona a medias y confunde al type checker.
- El `try/finally: await session.close()` sobra: el `async with` ya cierra la sesión.
- `asyncpg` **no acepta** `sslmode` ni `gssencmode` en `connect_args` (son parámetros de
  libpq). Si los copias del ejemplo síncrono, revienta al conectar. Para desactivar TLS con
  asyncpg se usa `ssl=False`.

---

## Ejemplos de uso

### Síncrono

```python
from fastapi import FastAPI, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session
from config import get_db

app = FastAPI()

@app.get("/health")
def health(response: Response, db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as e:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "detail": str(e)}

@app.get("/tablas")
def tablas(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
    """))
    return {"tablas": [r[0] for r in result.fetchall()]}
```

**`text()` es obligatorio.** En SQLAlchemy 2.x, `db.execute("SELECT 1")` con un string crudo
lanza `ArgumentError: Textual SQL expression should be explicitly declared as text(...)`. El
ejemplo anterior de este documento no lo llevaba: si copiaste de ahí, tu `/health` está roto
o "pasa" silenciosamente por el `except`.

### Async

```python
from fastapi import FastAPI, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from config import get_db

app = FastAPI()

@app.get("/health")
async def health(response: Response, db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as e:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "detail": str(e)}
```

### Conexión directa (psycopg)

```python
import psycopg

with psycopg.connect(
    host="172.31.2.40",
    port=5432,
    dbname="<tu_base>",
    user="<tu_usuario>",
    password="<tu_contraseña>",
    connect_timeout=10,
    gssencmode="disable",
    sslmode="disable",
) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT version()")
        print(cur.fetchone())
```

Con `psycopg2` es igual salvo que el parámetro se llama `database=` en vez de `dbname=`.

---

## `/health` — el punto donde un fallo se disfraza de app sana

El smoke test del despliegue hace un único `curl -sf http://127.0.0.1:${APP_PORT}/health`.
`curl -sf` falla con cualquier código >= 400 y **no sigue redirecciones**. De ahí tres reglas:

1. **Sin autenticación y sin 3xx.** Un 302 a login hace fallar el despliegue.
2. **Si algo esencial está roto, devolver 503, no 200.** Un handler que atrapa la excepción
   y devuelve `{"status": "error"}` con código 200 hace que el smoke test dé **verde** con la
   base caída. Por eso los ejemplos de arriba fijan `response.status_code`.
3. **Un fallo de datos también cuenta.** Caso real de esta flota: el seed de catálogo moría
   con `KeyError: 'comunas'`, el código atrapaba la excepción a propósito para no dejar el
   contenedor en crash-loop, y la app arrancaba con `/health` en 200 y la base **vacía**. El
   deploy salió verde y nadie se enteró durante días.

   No hace falta volver al crash-loop para arreglarlo. Alternativas, de más barata a menos:
   validar el dato en el `Dockerfile` con un `RUN` (build roto = los contenedores viejos
   siguen sirviendo), exponer un `/ready` aparte que sí refleje el estado de los datos, o
   hacer que `/health` distinga "el proceso vive" de "el servicio sirve para algo".

---

## Iniciar la aplicación

### Desarrollo (local)

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Producción (Docker)

**Dockerfile:**

```dockerfile
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

Sobre `--workers 4`: son 4 procesos independientes, cada uno con **su propio pool de
conexiones**. Contra un Postgres compartido eso multiplica por 4 las conexiones de esta app;
si varias apps hacen lo mismo, se llega al `max_connections` del servidor. Ajustá el número
de workers al tamaño real de la app y, si hace falta, limitá `pool_size` en `create_engine`.

**Construir y ejecutar:**

```bash
docker build -t conaf-api:latest .

docker run -d --name conaf-api -p 8000:8000 --env-file .env conaf-api:latest
```

Pasar el `.env` con `--env-file` en vez de repetir seis `-e`: menos ruido y no deja la
contraseña en el historial del shell ni en `docker inspect` de forma tan evidente.

**Verificar:**

```bash
docker logs conaf-api
curl -i http://localhost:8000/health     # -i para VER el código, no solo el cuerpo
```

**docker-compose.yml** (para varios servicios):

```yaml
services:
  api:
    build: .
    env_file: .env
    ports:
      - "${APP_PORT:-8080}:8000"
    restart: unless-stopped
```

Sin clave `version:`: está obsoleta en Compose v2+ y ninguna app de la flota la usa.
Y `docker compose up -d`, no `docker-compose` con guion, que es la v1 descontinuada.

En el despliegue real de CONAF, este servicio no se levanta a mano: lo hace el workflow
reusable de `infra-docker-base`. Ver la Guía 6.

---

## Troubleshooting

### Error: `Textual SQL expression should be explicitly declared as text(...)`

SQLAlchemy 2.x no acepta strings crudos en `execute()`. Envolver en `text()`:
`db.execute(text("SELECT 1"))`.

### Error: GSSAPI security context

```
OperationalError: ... could not initiate GSSAPI security context
```

Agregar `gssencmode="disable"` (y `sslmode="disable"`) en `connect_args`. Con **asyncpg**
esos parámetros no existen: usar `ssl=False`.

### Error: no pg_hba.conf entry for host

```
FATAL: no pg_hba.conf entry for host "x.x.x.x", user "...", database "..."
```

Tu IP no está autorizada en el servidor PostgreSQL. Ojo: desde un contenedor, la IP que ve
Postgres es la de la VM (172.31.2.41 o .42), no la del contenedor.

### Error: connection refused

```
could not connect to server: Connection refused
```

```bash
# Desde la VM, sin cliente psql instalado:
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/172.31.2.40/5432' && echo abierto || echo cerrado

# Desde el servidor PostgreSQL
sudo ss -tlnp | grep 5432
```

### Errores intermitentes de conexión cerrada

`server closed the connection unexpectedly` que aparece y desaparece: conexiones muertas en
el pool. Es lo que resuelven `pool_pre_ping=True` y `pool_recycle`.

### El cliente `psql` de la VM es más viejo que el servidor

En vm2 hay `psql` 16.14 contra un servidor 17.10. Para consultas normales da igual, pero
`pg_dump` de un cliente 16 contra un servidor 17 falla con un error de versión. Si necesitás
respaldos, usá el cliente 17 o hacelos desde el propio servidor de base de datos.
