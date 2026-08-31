# COIPO_NEXE

## Descripción
Plataforma de monitoreo y gestión de recursos con capacidades de visualización cartográfica, seguimiento en tiempo real y exportación de datos.

## Arquitectura
- **Frontend**: Aplicación React con TypeScript
- **Backend**: API REST con FastAPI y Python
- **Base de datos**: PostgreSQL
- **Recolector**: Servicio independiente para ingesta de datos
- **Contenedores**: Docker para todos los componentes

## Stack técnico
- **Frontend**: React, TypeScript, Vite, Leaflet, Tailwind CSS
- **Backend**: Python, FastAPI, SQLAlchemy, Pandas
- **Base de datos**: PostgreSQL
- **Contenedores**: Docker, docker-compose
- **Herramientas**: Node.js, npm

## Estructura del proyecto
```
├── backend/          # API FastAPI
├── frontend/         # Aplicación React
├── collector/        # Servicio de recolección de datos
├── db/               # Esquemas y scripts de base de datos
├── INSUMO/           # Documentación y recursos
├── INSUMO_PRODUCCION/# Guías de producción
└── .github/          # Workflows de CI/CD
```

## Instalación
1. Clonar el repositorio
2. Configurar variables de entorno (ver sección Configuración)
3. Ejecutar con Docker:
   ```bash
   docker-compose up -d
   ```

## Configuración
Variables de entorno requeridas:
- `NEXE_API_KEY`: Clave de API para NEXE
- `NEXE_BASE_URL`: URL base del servicio NEXE
- `VITE_API_BASE`: URL base de la API para el frontend
- `SCHEMA_SQL_PATH`: Ruta al archivo de esquema SQL
- `VITE_DEMO`: Modo demo (true/false)

## Ejecución
### Desarrollo
```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev

# Recolector
cd collector
docker build -t collector .
docker run collector
```

### Producción
```bash
docker-compose -f docker-compose.yml up -d
```

## API
Endpoints disponibles:
- `GET /api/recursos` - Listar todos los recursos
- `GET /api/recursos/{esn}` - Obtener detalle de un recurso
- `GET /health` - Estado del servicio
- `GET /api/posiciones/incremental` - Posiciones incrementales
- `GET /api/posiciones` - Posiciones por rango
- `GET /api/estado-ingesta` - Estado de ingesta de datos
- `GET /api/exportar` - Exportar datos

## Base de datos
Tablas principales:
- `posicion`: Registros de ubicación de recursos
- `recurso`: Información de los recursos monitoreados
- `estado_ingesta`: Estado del proceso de ingesta de datos

## Pruebas
- Backend: Tests unitarios en `backend/tests/`
- Frontend: Tests en `frontend/tests/`

## Despliegue
Configuración de despliegue automatizado:
- GitHub Actions para despliegue en producción
- Despliegue de frontend en Pages
- Despliegue de backend y servicios contenerizados

## Limitaciones conocidas
- La autenticación utiliza JWT pero no está completamente documentada
- El procesamiento de datos puede ser intensivo para grandes volúmenes de posiciones
- La exportación está limitada a formatos CSV y GeoJSON
