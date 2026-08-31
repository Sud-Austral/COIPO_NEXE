# Conexión FastAPI → PostgreSQL 17

**Servidor:** 172.31.2.40:5432  
**Base de datos:** PostgreSQL 17  
**Esquema:** public

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

---

## Instalación

```bash
pip install fastapi uvicorn psycopg2-binary sqlalchemy
# o para async:
pip install fastapi uvicorn asyncpg sqlalchemy
```

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
    connect_args={
        "connect_timeout": 10,
        "gssencmode": "disable",
        "sslmode": "disable",
    }
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### SQLAlchemy (async)

```python
# config.py (async)
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
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
    connect_args={
        "timeout": 10,
    }
)

AsyncSessionLocal = sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
```

---

## Ejemplos de uso

### Síncrono

```python
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from config import get_db

app = FastAPI()

@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute("SELECT 1")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@app.get("/tablas")
def tablas(db: Session = Depends(get_db)):
    result = db.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
    """)
    return {"tablas": [r[0] for r in result.fetchall()]}
```

### Async

```python
from fastapi import FastAPI, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from config import get_db

app = FastAPI()

@app.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@app.get("/tablas")
async def tablas(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
    """))
    return {"tablas": [r[0] for r in result.fetchall()]}
```

### Conexión directa (psycopg2)

```python
import psycopg2

conn = psycopg2.connect(
    host="172.31.2.40",
    port=5432,
    database="<tu_base>",
    user="<tu_usuario>",
    password="<tu_contraseña>",
    connect_timeout=10,
    gssencmode="disable",
    sslmode="disable",
)

cur = conn.cursor()
cur.execute("SELECT version()")
print(cur.fetchone())
cur.close()
conn.close()
```

---

## Iniciar la aplicación

### Desarrollo (local)

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Producción (Docker)

**Dockerfile:**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

**Construir imagen:**

```bash
docker build -t conaf-api:latest .
```

**Ejecutar contenedor:**

```bash
docker run -d \
  --name conaf-api \
  -p 8000:8000 \
  -e DATABASE_HOST=172.31.2.40 \
  -e DATABASE_PORT=5432 \
  -e DATABASE_USER=<usuario> \
  -e DATABASE_PASSWORD=<contraseña> \
  -e DATABASE_NAME=<base> \
  conaf-api:latest
```

**Verificar:**

```bash
docker logs conaf-api
curl http://localhost:8000/health
```

**docker-compose.yml** (opcional, para múltiples servicios):

```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_HOST: 172.31.2.40
      DATABASE_PORT: 5432
      DATABASE_USER: ${DATABASE_USER}
      DATABASE_PASSWORD: ${DATABASE_PASSWORD}
      DATABASE_NAME: ${DATABASE_NAME}
    restart: unless-stopped
```

Ejecutar:

```bash
docker-compose up -d
```

---

## Troubleshooting

### Error: GSSAPI security context

```
OperationalError: ... could not initiate GSSAPI security context
```

**Solución:** Agregar `gssencmode="disable"` en `connect_args`:

```python
engine = create_engine(
    DATABASE_URL,
    connect_args={"gssencmode": "disable", "sslmode": "disable"}
)
```

### Error: no pg_hba.conf entry for host

```
FATAL: no pg_hba.conf entry for host "x.x.x.x", user "...", database "..."
```

**Solución:** Verificar que tu IP está autorizada en el servidor PostgreSQL.

### Error: connection refused

```
could not connect to server: Connection refused
```

**Verificar:**

```bash
# Desde tu estación
ping 172.31.2.40
telnet 172.31.2.40 5432

# Desde el servidor PostgreSQL
sudo ss -tlnp | grep 5432
```
