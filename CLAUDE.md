# CLAUDE.md — Visor Táctico de Flota Aérea CONAF (Nexe · AFF JSON)

> **Para la IA que trabaje en este repositorio:** este archivo es la fuente de verdad del proyecto.
> Léelo completo antes de escribir código. Las secciones marcadas **CONFIRMADO** provienen de
> pruebas reales contra el servidor de Nexe; las marcadas **PENDIENTE** deben verificarse contra
> la respuesta real antes de fijar código que dependa de ellas. Ante conflicto entre este archivo
> y la respuesta real del servidor, **gana el servidor** — y debes actualizar este archivo.

---

## 1. Propósito

Aplicación web (React) para que el personal de CONAF (Corporación Nacional Forestal, Chile)
visualice **en tiempo casi real las posiciones de sus recursos aéreos** (helicópteros y aviones
de combate de incendios forestales) transmitidas por la plataforma **Nexe** (Heligrafics Chile SpA)
mediante servicios basados en el estándar **AFF JSON** (Automated Flight Following, USDA Forest Service).

Usuarios objetivo: operadores de centrales de coordinación (CENCO/CENCOR) y analistas de la
Gerencia de Protección contra Incendios Forestales. Idioma de toda la interfaz: **español (Chile)**.

La app debe servir para responder en segundos: *¿dónde está cada aeronave ahora, en qué estado
está (volando / emitiendo en tierra / detenida), qué tan frescos son sus datos, y qué trayectoria
siguió en las últimas horas?*

---

## 2. Estado de la integración con Nexe

### CONFIRMADO (staging + correo de José C. del 3 de julio de 2026 con ejemplos reales request/response)

| Aspecto | Valor confirmado |
|---|---|
| Método HTTP | `POST` (con `GET` el servidor responde **405**) |
| Autenticación | Header **`api-key: <API_KEY>`** (otros esquemas — `X-API-Key`, `Bearer`, query param — devuelven **401** `{"detail": "Incorrect api key or JWT Token"}`) |
| Alcance de la key | **La key ya filtra los recursos de CONAF** — no hay que identificarse como CONAF en el body |
| Formato | Body **JSON obligatorio** (`Content-Type: application/json`) |
| Campos raíz del body | `type`, `dataCenter`, `msgRequest` (los tres **requeridos**; su ausencia produce 422) |
| Valor de `type` | **`"dataRequest"`** (literal exacto) |
| Ítems de `dataCenter` | **Objetos** `{"affVer": "...", "name": "...", "reqTime": "<ISO UTC>"}`. Los tres campos son **OBLIGATORIOS** (probado 7-jul: omitirlos → 422 `Field required`); el servidor acepta `"string"` literal como valor de `affVer`/`name` |
| Ítems de `msgRequest` | **Objetos** `{"to": "...", "from": "...", "msgType": "...", "dataCtrTime": "<ISO UTC>"}` — **`dataCtrTime` es EL filtro**: "todo lo llegado al servidor DESPUÉS de esta fecha". `to`/`from`/`msgType` son **OBLIGATORIOS** (422 si se omiten); `"string"` literal es aceptado |
| Un solo ítem por lista | No se soportan varios elementos en `dataCenter`/`msgRequest` (respuesta explícita de Nexe) |
| Formato de fechas | **ISO 8601 UTC con milisegundos y `Z`**: `"2026-07-03T13:12:06.137Z"` (= `Date.prototype.toISOString()`) |
| Semántica del filtro | **Estrictamente mayor (`>`)** sobre `dataCtrTime` |
| Límite por respuesta | **Exactamente 1000 posiciones** (observado 7-jul en corridas reales). Paginación: repetir la llamada con `dataCtrTime` = el del último registro devuelto |
| Filtro por ESN | **No existe** — siempre devuelve la totalidad de recursos de la key según fecha de control |
| Filtro `domain` | Solo en `get_lastpositions`, dentro del ítem de `msgRequest`, y debe ser **lista** (con string devuelve 422 *"Input should be a valid list"*). **PERO** con valores válidos (`["ground"]`, `["Ground"]`) staging devuelve **500** — bug reportable a Nexe. **No usar hasta que lo aclaren**; filtrar por familia en el cliente |
| Respuesta 200 | **GeoJSON `FeatureCollection`**: `{type, dataInfo: [{affVer, provider, rptTime}], features: [...]}`; cada feature = `{type: "Feature", properties: {...}, geometry: {type: "Point", coordinates: [lon, lat]}}` (ver §7.3) |
| Campos `hg*` | Vienen **solo en `get_lastpositions`** — en `/get` solo llega `hgExtName`. Ojo: `/get` SÍ trae además `unitId`, `atu` y `hdop` (observado 7-jul, más de lo que mostraba el ejemplo del correo) |
| `hgNavstate` | Solo valores 2, 4, 5 — y llega como **string** (`"2"`) |
| Campo `fix` | Indica lo **configurado en la baliza** (3D o 2D), no la calidad del fix puntual — **no descartar 2D** |
| Listas vacías | `dataCenter: []` o `msgRequest: []` → **500** (nunca enviarlas) |
| Backend del servidor | Estilo FastAPI/Pydantic v2: los 422 traen `detail[].loc/type/msg` |
| Datos de staging | **Posiciones reales** (copia de producción) en **ventana móvil de ~1 semana que corre días detrás del presente** (el 7-jul los datos llegaban hasta el 5-jul). 11 recursos observados, familias `ground`/`fixed`/`people` (sin `rotary` en esa copia). ⇒ con el rango de 2 h del polling normal, `/get` puede venir vacío en staging: los recursos se pintan igual gracias a `get_lastpositions` (lookback 14 días), marcados "sin señal reciente" — comportamiento correcto |
| Paso a producción | **Solo cambia la URL** (misma key) |
| Soporte | `soporte.monitor@heligrafics.net` (detalle de la incidencia + ejemplo claro). **No hay** endpoint de heartbeat |
| CORS | **El servidor NO implementa CORS** (verificado 8-jul: `OPTIONS` → 405 y las respuestas no traen `Access-Control-Allow-Origin`). ⇒ El navegador **no puede** llamar a Nexe directamente aunque tuviera la key: el proxy server-side no es opcional |

### PENDIENTE de confirmar

1. **Campo de altitud** — no observado en NINGUNA corrida real (7-jul: 3.000 posiciones
   revisadas, 0 con `alt`/`altitude`; eran medios terrestres y aviones en tierra). Confirmar
   nombre y unidad con una aeronave en vuelo; el parser lo busca tolerante (`alt`/`altitude`,
   y la 3ª coordenada GeoJSON si viniera).
2. **Unidades de `spd`** — **m/s DESCARTADO** con datos reales (furgonetas con `spd` 33–67:
   241 km/h es imposible). Hipótesis de trabajo: **nudos** (convención AFF/aeronáutica); la UI
   convierte kn → km/h en `src/lib/format.ts` (único lugar a corregir si fuera km/h).
   Preguntar a Nexe.
3. **Bug del `domain`** — forma confirmada (lista en el ítem de `msgRequest`) pero staging
   devuelve 500 con valores válidos. Reportar a `soporte.monitor@heligrafics.net` con el
   ejemplo: body oficial + `"domain": ["ground"]` → `{"detail": "Internal Server Error"}`.
4. **Vigencia de la key** — la key del correo del 3-jul devolvió **401** el 6-jul y **200**
   el 7-jul (¿activación tardía? ¿intermitencia?). Si vuelve el 401, pedir key vigente a
   José C. La key vive en `frontend/.env` (`NEXE_API_KEY`), jamás al repo.

**Cómo resolver los pendientes:** una corrida `/get` con una aeronave en vuelo (altitud +
velocidad conocida) cierra 1 y 2; el 3 es de Nexe. El Swagger
`https://staging.nexe.online/api/v1/monitor/docs` puede adelantar el esquema exacto.

### Volcar el esquema OpenAPI al repo (2 minutos; elimina casi todos los PENDIENTE)

El Swagger de Nexe es un Swagger UI estándar (backend estilo FastAPI), por lo que **toda la
documentación existe como un único JSON** con el esquema completo de la API. Una persona con
acceso de red al dominio debe, una sola vez:

1. Abrir `https://staging.nexe.online/api/v1/monitor/docs` en el navegador. Bajo el título del
   Swagger aparece enlazado el documento OpenAPI (habitualmente `.../openapi.json`; si no es
   visible, la pestaña Red/Network del navegador lo muestra al cargar la página).
2. Guardar ese JSON en el repositorio como **`docs/nexe-openapi.json`**. No contiene la API key,
   así que puede commitearse sin riesgo.

**Regla para la IA:** si `docs/nexe-openapi.json` existe, es **la fuente de verdad definitiva del
contrato** — nombres y tipos exactos de request y response, campos requeridos, enums y ejemplos —
por sobre las hipótesis de esta sección e incluso por sobre `nexe_bodies_descubiertos.json` en
cuanto a nombres de campos. A partir de él: (a) genera/corrige `src/api/contract.ts`, (b) fija el
parser de `src/api/parse.ts` con el esquema de respuesta real, y (c) actualiza las secciones 2,
7 y 8 de este archivo en el mismo commit, moviendo los ítems de PENDIENTE a CONFIRMADO.

> **Regla dura:** no fijes en el código un parser rígido de la respuesta hasta ver un 200 real.
> El parser inicial debe ser tolerante (ver §8.2).

---

## 3. Arquitectura — regla innegociable

**El frontend NUNCA llama a Nexe directamente.** Dos razones: la API key no puede viajar en el
bundle del navegador (secreto server-side), y el navegador chocaría con CORS. La arquitectura es:

```
┌────────────────┐     /api/nexe/*      ┌──────────────────┐   api-key inyectada   ┌─────────────────┐
│  React (Vite)  │ ───────────────────▶ │  Proxy backend    │ ────────────────────▶ │  Nexe (staging/ │
│  navegador     │ ◀─────────────────── │  Node + Express   │ ◀──────────────────── │  producción)    │
└────────────────┘      JSON            └──────────────────┘                        └─────────────────┘
```

Reglas del proxy (`server/`):
- Expone **solo** dos rutas: `POST /api/nexe/get` y `POST /api/nexe/lastpositions`
  (allowlist; nada de proxy genérico).
- Inyecta el header `api-key` desde `process.env.NEXE_API_KEY`. La key **jamás** se loguea,
  jamás se devuelve al cliente, jamás aparece en errores.
- Reenvía el body JSON tal cual lo arma el frontend (el contrato del body vive en un módulo
  compartido, ver §8.1).
- Timeout 30 s hacia Nexe; ante error de red devuelve `502` con `{error: "upstream_unreachable"}`.
- Propaga status y body de Nexe en 4xx/5xx para que el frontend pueda diagnosticar (los 422 de
  Nexe son informativos y valiosos).
- Rate-limit defensivo: máximo 4 req/s hacia Nexe (el estándar AFF pide polling ≥ 30 s; ver §8.3).
- En desarrollo, Vite proxya `/api` → `http://localhost:3001` (config en `vite.config.ts`).

### Despliegue estático (GitHub Pages) — solo modo demo

GitHub Pages no ejecuta servidores, y Nexe no implementa CORS (§2), así que un despliegue
estático **no puede** mostrar datos reales llamando a Nexe — ni siquiera embebiendo la key
(el navegador aborta en el preflight; además la key en un repo público expondría el rastreo
de la flota). Por eso:

- El workflow `.github/workflows/despliegue-pages.yml` construye con **`VITE_DEMO=1`**:
  `postNexe()` atiende las peticiones con el simulador compartido
  (`src/demo/simuladorNexe.ts`) **dentro del navegador** — cero red, cero key, banner
  "MODO SIMULACIÓN" visible. `VITE_BASE=/COIPO_NEXE/` fija la subruta de Pages.
- Para datos reales en un hosting estático: desplegar `server/index.ts` en un servicio con
  entorno server-side (Cloud Run, Render, etc.) con `NEXE_API_KEY` como variable de entorno,
  y construir el frontend con `VITE_API_BASE=https://<proxy>/api/nexe`. La key jamás al bundle.

---

## 4. Stack

| Capa | Elección | Notas |
|---|---|---|
| Frontend | **React 19 + Vite + TypeScript** | SPA. Sin Next.js (no se necesita SSR). |
| Mapa | **react-leaflet 4 + Leaflet 1.9** con tiles OSM | Atribución OSM obligatoria visible. Sin API keys de mapas. |
| Estado | Hooks + Context (o Zustand si crece) | No Redux. |
| Estilos | CSS Modules **o** Tailwind — elegir UNO y ser consistente | Tokens semánticos en `:root` (§10.1); **prohibido hex crudo en componentes**. |
| Íconos | **lucide-react** | Una sola familia. **Prohibido usar emojis como íconos.** |
| Fechas | `date-fns` (con `date-fns-tz` si hace falta) | Todo el intercambio con la API en **UTC**; presentación en hora de Chile (`America/Santiago`). |
| Backend proxy | **Node 20 + Express 4** | Un solo archivo `server/index.ts` está bien. |
| Tests | **Vitest** (+ Testing Library para componentes clave) | Ver §12. |
| Lint/format | ESLint + Prettier configuración estándar | |

Estructura de carpetas REAL (la app vive en `frontend/`; actualizada jul-2026):

```
/
├── CLAUDE.md                       ← este archivo
├── descargar_historico_nexe.py    ← extractor batch diario → datos_historicos/*.csv (análisis)
├── datos_historicos/               ← CSVs descargados (en .gitignore, no se commitean)
├── .github/workflows/despliegue-pages.yml  ← demo estática en GitHub Pages (VITE_DEMO=1, §3)
└── frontend/
    ├── server/
    │   ├── index.ts               ← proxy Express (allowlist, api-key, timeouts)
    │   ├── mock.ts                ← servidor simulado HTTP (§9; usa src/demo/simuladorNexe)
    │   └── validacionNexe.ts      ← validación 422/500 estilo Pydantic (compartida, testeada)
    ├── src/
    │   ├── api/
    │   │   ├── contract.ts        ← builders del body (ÚNICO lugar donde se arma)
    │   │   ├── client.ts          ← fetch al proxy, errores tipados; modo demo (VITE_DEMO)
    │   │   └── parse.ts           ← parser FeatureCollection + fallbacks (§8.2)
    │   ├── demo/simuladorNexe.ts  ← generador de flota ficticia (mock HTTP + demo navegador)
    │   ├── domain/
    │   │   ├── types.ts           ← tipos (§8.4)
    │   │   ├── fleet.ts           ← agregación por ESN, dedupe, staleness, fusión hg*
    │   │   └── alertas.ts         ← transiciones de señal (puro, testeado)
    │   ├── hooks/
    │   │   ├── usePolling.ts      ← ciclo vivo con cursor + paginación (§8.3); pausable
    │   │   ├── useHistorico.ts    ← consulta única por rango libre (§11 Fase 2-7)
    │   │   └── useAlertas.ts      ← toasts de pérdida/recuperación de señal
    │   ├── components/
    │   │   ├── MapView/           ← mapa, marcadores (marcador.ts + marcadores.css), trails
    │   │   ├── FleetPanel/        ← KPIs por estado (filtran), búsqueda, tarjetas con riel
    │   │   ├── ResourceDetail/    ← ficha + MiniGrafico (sparklines velocidad/altitud)
    │   │   ├── TimeRangeBar/      ← presets vivo + rango histórico + export GeoJSON/CSV
    │   │   ├── StatusBar/         ← pills de conexión, banners (error/simulación/histórico)
    │   │   ├── Alertas/           ← toasts flotantes sobre el mapa
    │   │   └── EstadoChip/        ← color + ícono + texto del estado (compartido)
    │   ├── lib/
    │   │   ├── format.ts          ← hora Chile/UTC, km/h desde nudos, "hace X"
    │   │   └── exportar.ts        ← GeoJSON + CSV RFC 4180 de lo visible
    │   ├── ui/
    │   │   ├── strings.ts         ← TODOS los textos (español, §13)
    │   │   └── estadoVisual.ts    ← mapeo navState+freshness → texto/ícono/color
    │   ├── styles/tokens.css      ← design tokens (§10.1) + extensiones (§10.4)
    │   ├── styles/base.css        ← reset, foco, reduced-motion, overrides Leaflet
    │   └── main.tsx / App.tsx
    ├── tests/                     ← 66 tests Vitest + fixtures reales (§12)
    ├── .env.example               ← plantilla (NUNCA commitear .env real)
    └── vite.config.ts             ← proxy /api→3001; base configurable (VITE_BASE)
```

---

## 5. Comandos

```bash
npm install
npm run dev            # Vite (frontend) + proxy Express en paralelo (usar concurrently)
npm run dev:mock       # igual, pero el proxy apunta al servidor simulado local (§9) — sin key
npm run build          # build de producción del frontend
npm run server         # solo el proxy Express
npm run test           # vitest
npm run lint           # eslint
```

---

## 6. Variables de entorno y seguridad

`.env` (server-side, **fuera del repo**, listado en `.gitignore`):

```bash
NEXE_BASE_URL=https://staging.nexe.online/api/v1/monitor
NEXE_API_KEY=<key del correo de Nexe — pedir al equipo; es la del servidor de PRUEBAS>
PORT=3001
```

Frontend (`.env` de Vite, sin secretos):

```bash
VITE_API_BASE=/api/nexe
```

Reglas de seguridad:
- La API key es **solo de servidor**. Ninguna variable `VITE_*` puede contenerla
  (todo `VITE_*` termina en el bundle público).
- No loguear la key ni bodies que la contengan. No incluirla en mensajes de error.
- **Producción:** según Nexe, el paso a producción consiste **únicamente en cambiar
  `NEXE_BASE_URL`** (misma key/otra key que entregarán; mismos endpoints y contrato).
- No commitear `nexe_bodies_descubiertos.json` si algún día contuviera credenciales (hoy solo
  contiene la forma del body; eso sí puede commitearse).

---

## 7. Contrato de la API Nexe (AFF JSON)

### 7.1 Endpoints

Base (staging): `https://staging.nexe.online/api/v1/monitor`

| Endpoint | Uso | Semántica |
|---|---|---|
| `POST /position/affjson/get` | **Principal.** Posiciones por intervalo de tiempo | Devuelve TODAS las posiciones del rango: recibidas en tiempo real **y** históricos que llegaron a posteriori. Es el único método que no pierde puntos intermedios. Identificador del recurso: **ESN** (nº de serie del dispositivo instalado en la aeronave); el alias viene en `hgExtName`. |
| `POST /position/affjson/get_lastpositions` | Complementario. Solo la posición más reciente de cada recurso al momento de la consulta | Útil para pintar el estado inicial de la flota en 1 llamada. **No** sirve para trazas (pierde puntos intermedios e históricos). |

Documentación oficial: Swagger en `<BASE_URL>/docs` (requiere autenticarse con la key; incluye
el PDF del estándar AFF enlazado arriba).

### 7.2 Request

Headers:

```
Content-Type: application/json
api-key: <NEXE_API_KEY>          ← exactamente este nombre de header
```

Body — **CONFIRMADO** con el ejemplo oficial de Nexe (correo 3-jul-2026). Enviar idéntico al
ejemplo (los `"string"` son placeholders literales del ejemplo oficial que el servidor acepta):

```jsonc
{
  "type": "dataRequest",              // literal exacto
  "dataCenter": [
    {
      "affVer": "string",             // informativo (placeholder aceptado)
      "name": "string",               // informativo (la key ya identifica a CONAF)
      "reqTime": "2026-07-03T13:12:06.137Z"   // hora de ESTA solicitud, ISO UTC con ms
    }
  ],
  "msgRequest": [
    {
      "to": "string",                 // placeholder
      "from": "string",               // placeholder
      "msgType": "string",            // placeholder
      "dataCtrTime": "2026-06-17T13:12:06.137Z" // EL FILTRO: llegados al servidor DESPUÉS (>) de esta fecha
    }
  ]
}
```

Para `get_lastpositions` el body es el mismo; opcionalmente acepta el filtro `domain`
(familia: `people`/`ground`/`rotary`/`fixed`) — si no se usa, **no incluir el parámetro**.

Comportamientos observados (útiles para manejo de errores y para tests):

| Situación | Respuesta del servidor |
|---|---|
| `GET` a cualquiera de los dos endpoints | `405` |
| Header de auth distinto de `api-key` o key inválida | `401` `{"detail": "Incorrect api key or JWT Token"}` |
| Body sin alguno de los 3 campos raíz | `422` con `detail[].loc = ["body", "<campo>"]`, `msg = "Field required"` |
| `type` con valor incorrecto | `422` con `msg = "Input should be 'dataRequest'"` |
| `dataCenter`/`msgRequest` no-lista | `422` con `msg = "Input should be a valid list"` |
| Listas vacías (`[]`) | **`500` Internal Server Error** — evitarlo siempre |
| Más de ~1000 posiciones en el rango | Respuesta truncada a ~1000 — paginar repitiendo con el último `dataCtrTime` recibido |

### 7.3 Estructura de la respuesta 200 (CONFIRMADA — ejemplos reales del correo 3-jul-2026)

Ambos endpoints devuelven **GeoJSON FeatureCollection**:

```jsonc
{
  "type": "FeatureCollection",
  "dataInfo": [ { "affVer": "json 1.0", "provider": "Nexe", "rptTime": "2026-07-03T13:12:34Z" } ],
  "features": [
    {
      "type": "Feature",
      "properties": { /* telemetría — ver tabla */ },
      "geometry": { "type": "Point", "coordinates": [ -71.542791, -32.946836 ] }  // ¡[lon, lat]!
    }
  ]
}
```

> **OJO:** `geometry.coordinates` viene en orden GeoJSON **[longitud, latitud]** — invertir para
> Leaflet, que usa `[lat, lon]`.

**`properties` en `/get`** (telemetría mínima + `hgExtName`):

| Campo | Tipo | Semántica |
|---|---|---|
| `esn` | string | Nº de serie de la baliza — **clave primaria del recurso** |
| `posTime` | datetime UTC | Hora del reporte GPS (hora de la **posición**) |
| `dataCtrTime` | datetime UTC | Llegada al servidor Nexe (clave del polling, §7.4) — trae microsegundos |
| `cog` | int | Course over ground: rumbo 0–359° desde el norte verdadero — rotar el marcador |
| `spd` | int | Velocidad (**PENDIENTE unidad** — m/s descartado con datos reales; hipótesis nudos) |
| `fix` | string | `3D`/`2D` — **configuración de la baliza**, no calidad puntual: no descartar 2D |
| `src` | string | Fuente de la posición (p. ej. `"GPS"`) |
| `pdop` / `hdop` | int | Calidad de la posición (ambos observados en corridas reales del 7-jul) |
| `unitId` | string | Identificador de unidad (también viene en `/get`, observado 7-jul) |
| `atu` | object | Eventos (p. ej. `{events:{aircraft:{power:"off"}}}`) — también en `/get` |
| `hgExtName` | string | Alias del recurso (único campo `hg*` presente en `/get`) |
| altitud | ? | **No observada aún** (3.000 posiciones reales revisadas sin `alt`) — parser tolerante |

**`properties` adicionales SOLO en `get_lastpositions`** (metadatos del recurso):

| Campo | Significado |
|---|---|
| `unitId` | Identificador de unidad (suele coincidir con la patente) |
| `hgAlias` | Alias de cliente |
| `hgAsset` | **Patente/matrícula** del medio |
| `hgAssetModel` | Modelo (p. ej. "Bell 412", "Peugeot Boxer") |
| `hgAssetFamily` | Familia legible (p. ej. "Ala rotatoria", "Furgonetas") |
| `hgFamilyType` | Familia canónica: `people` / `ground` / `rotary` / `fixed` |
| `hgCompany` | Compañía propietaria (p. ej. "CONAF") |
| `hgSource` | Proveedor de la baliza (p. ej. "Iridium", "Star Connect GPS") |
| `hgNavstate` | **String** `"2"`/`"4"`/`"5"`: 2 = Parado · 4 = Emitiendo en tierra · 5 = En ruta. Solo esos 3 valores |
| `atu` | Objeto de eventos (p. ej. `{events: {aircraft: {power: "off"}}}`) — informativo |

⇒ **Consecuencia para la app:** los metadatos (patente, modelo, familia, navstate) se obtienen de
`get_lastpositions` y se **fusionan por ESN** sobre las trazas que entrega `/get`. El ciclo de
polling consulta ambos (ver §8.3).

Datos operativos del estándar AFF útiles para la UX:
- Cada unidad reporta **al menos una posición cada ~2 minutos** (los ejemplos reales muestran
  reportes cada ~30–60 s).
- La latencia máxima esperable entre `posTime` y llegada al servidor es **< 2 minutos**.
- ⇒ Si `ahora − posTime > 4–5 min`, el recurso debe mostrarse como **"sin señal reciente"**.
- La flota de la key incluye **medios terrestres** (`hgFamilyType: "ground"`) además de aeronaves:
  la UI los muestra a todos e indica la familia (filtro por familia: Fase 2).

### 7.4 `dataCtrTime` vs `posTime` — el corazón del tiempo real

- `posTime`: cuándo la aeronave ESTABA en ese punto.
- `dataCtrTime`: cuándo esa posición LLEGÓ al servidor de Nexe. Posiciones antiguas pueden llegar
  tarde (históricos por cobertura satelital intermitente).
- **Por eso el polling se pagina por `dataCtrTime`**, no por `posTime`: cada consulta pide "todo
  lo que haya llegado al servidor desde el último `dataCtrTime` que recibí". Así no se pierden ni
  las posiciones en vivo ni los históricos rezagados. (Indicación explícita de Nexe.)
- El filtro es **estrictamente mayor (`>`)**: usar como cursor exactamente el último `dataCtrTime`
  recibido no repite ese registro (los microsegundos hacen improbable perder empates).
- **Límite ~1000 posiciones por respuesta**: si una tanda llega "llena", repetir la consulta con
  el cursor avanzado hasta que llegue una tanda corta (indicación explícita de Nexe).

---

## 8. Implementación del cliente de datos

### 8.1 `src/api/contract.ts` — único lugar donde se arma el body

```ts
// Refleja el ejemplo oficial de Nexe (correo 3-jul-2026). Los "string" son
// placeholders literales del ejemplo que el servidor acepta (PENDIENTE §2.1
// probar si pueden omitirse; hasta entonces, imitar el ejemplo exacto).
export const NEXE_TYPE = "dataRequest" as const;

function dataCenterItem(): DataCenterItem {
  return { affVer: "string", name: "string", reqTime: new Date().toISOString() };
}

// /position/affjson/get — posiciones llegadas al servidor DESPUÉS (>) de fromIsoUtc
export function buildGetBody(fromIsoUtc: string): NexeRequest {
  return {
    type: NEXE_TYPE,
    dataCenter: [dataCenterItem()],
    msgRequest: [{ to: "string", from: "string", msgType: "string", dataCtrTime: fromIsoUtc }],
  };
}

// /position/affjson/get_lastpositions — `domain` va como LISTA y SOLO si se filtra.
// OJO: hoy staging devuelve 500 al usarlo (bug escalado a Nexe) — la app no lo envía.
export function buildLastPositionsBody(fromIsoUtc: string, domain?: FamilyType): NexeRequest {
  const msg: MsgRequestItem = { to: "string", from: "string", msgType: "string", dataCtrTime: fromIsoUtc };
  if (domain) msg.domain = [domain]; // si no se filtra, el parámetro NO va en la llamada
  return { type: NEXE_TYPE, dataCenter: [dataCenterItem()], msgRequest: [msg] };
}
```

Si el servidor responde 422 a estos bodies, el mensaje `detail[]` dice exactamente qué corregir:
corrige **aquí** (y solo aquí), y anota el cambio en la sección 2 de este archivo.

### 8.2 `src/api/parse.ts` — parser congelado a FeatureCollection, con fallback tolerante

La respuesta real es GeoJSON (§7.3). El parser debe:

1. **Camino principal (congelado):** objeto con `features: []` → aplanar cada feature:
   `{...properties, latitude: coordinates[1], longitude: coordinates[0]}` (¡GeoJSON es [lon, lat]!).
2. Mapear nombres reales: `cog` → heading, `spd` → speed, `fix` → fixType, `hgNavstate` string →
   number. Tolerancia de mayúsculas y alias se mantiene (`lat`/`latitude`, `alt`/`altitude`…)
   porque la altitud aún no se ha observado (§2 PENDIENTE).
3. Detectar error disfrazado: un objeto `{detail: ...}` y nada más **no es data**, es un error
   FastAPI — propagar como error tipado.
4. **Fallbacks** (por si el contrato evoluciona): lista directa de objetos; u objeto con la
   primera propiedad que sea lista de objetos (`positions`, `data`, `items`, `results`,
   `reports`, `affjson`).
5. Fixtures reales (del correo 3-jul-2026, anonimizadas) en `tests/fixtures/`.

### 8.3 `src/hooks/usePolling.ts` — ciclo de tiempo real

```
estado inicial:
  cursor = ahora_UTC − 2 horas          // primera carga: últimas 2 h de historia
loop cada POLL_INTERVAL (default 30 s, mínimo permitido 30 s — estándar AFF):
  // 1) trazas: /get paginado (límite ~1000 por respuesta, filtro estrictamente >)
  repetir (máx. ~8 páginas por ciclo):
      resp = POST /api/nexe/get con buildGetBody(cursor)
      posiciones = parse(resp)
      si hay posiciones:
          cursor = max(dataCtrTime de la tanda)   // ← nunca retroceder el cursor
          merge en el store con dedupe por (esn, posTime)
      hasta que la tanda venga "corta" (< ~900 → ya no hay más páginas)
  // 2) metadatos + última posición por recurso: los hg* SOLO vienen aquí (§7.3)
  resp = POST /api/nexe/lastpositions (sin domain)
  merge de posiciones + fusión de metadatos por ESN (no mueve el cursor)
  actualizar staleness de cada recurso: ahora − max(posTime del recurso)
manejo de fallos:
  401 → banner "credenciales inválidas" + detener polling (no reintentar en loop)
  422 → banner técnico con el detail (indica contrato desalineado) + detener
  5xx / red → reintentos con backoff exponencial 5 s → 10 s → 20 s → 40 s (tope 60 s),
              banner "reintentando conexión con Nexe", NO resetear el cursor
visibilidad: pausar el polling cuando document.hidden; al volver, poll inmediato.
```

Reglas de datos:
- **Dedupe** por `(esn, posTime)` — el solapamiento de rangos produce duplicados esperables.
- **Buffer de trazas**: conservar en memoria como máximo las últimas **6 horas** o **1.000
  posiciones por ESN** (lo que ocurra primero); descartar lo más antiguo.
- Ordenar cada traza por `posTime` ascendente (no por orden de llegada — los históricos llegan
  desordenados).
- `fix` refleja la **configuración de la baliza** (3D/2D): **no descartar 2D**. Solo si llegara
  un valor `Invalid` (previsto por el estándar, no observado) se excluye del mapa y se cuenta en
  el badge de calidad del recurso.
- Los metadatos `hg*` de `get_lastpositions` se fusionan por ESN sobre las trazas de `/get`
  (que solo traen `hgExtName`): el recurso muestra siempre los últimos metadatos conocidos.

### 8.4 Tipos del dominio (`src/domain/types.ts`)

```ts
export type NavState = 2 | 4 | 5;             // en el JSON llega como string ("2") — coercionar
export type FamilyType = "people" | "ground" | "rotary" | "fixed";

export interface NexePosition {
  esn: string;
  posTime: string;        // ISO UTC
  dataCtrTime: string;    // ISO UTC (con microsegundos en el real)
  latitude: number;       // desde geometry.coordinates[1]
  longitude: number;      // desde geometry.coordinates[0]
  altitude?: number;      // m MSL — aún no observado en el real (§2 PENDIENTE)
  speed?: number;         // `spd` — hipótesis m/s (§2 PENDIENTE)
  heading?: number;       // `cog`, grados 0–359
  fixType?: "3D" | "2D" | "Invalid";  // `fix`: configuración de la baliza
  src?: string;           // fuente de la posición ("GPS")
  pdop?: number;
  hdop?: number;          // no observado aún
  unitId?: string;        // solo lastpositions
  hgExtName?: string;     // único hg* presente también en /get
  hgAlias?: string;       // los siguientes: solo lastpositions
  hgAsset?: string;
  hgAssetModel?: string;
  hgAssetFamily?: string;
  hgFamilyType?: FamilyType | string;
  hgCompany?: string;
  hgSource?: string;
  hgNavstate?: NavState;
}

export interface FleetResource {
  esn: string;
  label: string;              // hgExtName ?? hgAsset ?? esn
  last: NexePosition;
  trail: NexePosition[];      // ordenada por posTime asc, con tope (§8.3)
  navState: NavState | null;
  staleSeconds: number;       // ahora − last.posTime
  freshness: "live" | "delayed" | "stale";  // <2 min / 2–5 min / >5 min
}
```

---

## 9. Servidor simulado para desarrollo (`server/mock.ts`)

Para desarrollar sin key ni dependencia de staging, el repo incluye un mock Express que replica
el contrato **confirmado** (POST, header `api-key`, 422 estilo Pydantic si el body no cumple,
500 si las listas van vacías) y sirve posiciones ficticias.

Comportamiento requerido del mock:
- Valida header `api-key` (cualquier valor no vacío) → si falta, 401 idéntico al real.
- Valida forma del body (§7.2) devolviendo 422 con `detail[]` idéntico al real; listas vacías → 500.
- **Responde en el formato real**: GeoJSON FeatureCollection con `dataInfo` y `features`
  (`geometry.coordinates` en [lon, lat]; propiedades `cog`/`spd`/`fix`/`pdop`; `hgNavstate`
  como string). Los `hg*` completos van **solo** en `get_lastpositions`; `/get` solo lleva
  telemetría + `hgExtName` — igual que el servidor real.
- `/get`: filtro estrictamente `>` por `dataCtrTime` y **límite 1000** por respuesta (para
  ejercitar la paginación). Posiciones cada ~120 s de tiempo simulado sobre trayectorias
  sintéticas en la zona centro-sur de Chile (lat −33 a −38, lon −73 a −70), con `hgNavstate`
  variando, `dataCtrTime` avanzando e históricos rezagados ocasionales.
- `/get_lastpositions`: última posición de cada medio ficticio (aeronaves + al menos un medio
  terrestre `hgFamilyType: "ground"`, como en staging); soporta el filtro `domain`.
- Flags por env: `MOCK_FAIL_RATE=0.1` (probabilidad de 500), `MOCK_LATENCY_MS=800`.
- Los datos ficticios se marcan con `hgCompany: "SIMULADO"` — la UI muestra un banner
  "MODO SIMULACIÓN" cuando detecta ese valor.

---

## 10. Diseño de la interfaz

### 10.1 Dirección visual y tokens

Estética **táctica nocturna** coherente con los tableros existentes del equipo (navy oscuro +
teal). La sala de operaciones trabaja de noche durante la temporada de incendios: fondo oscuro,
datos de telemetría en monoespaciada, color reservado para **estado**, no para decoración.

`src/styles/tokens.css` (tokens semánticos; **prohibido** usar hex crudo en componentes):

```css
:root {
  /* superficies */
  --bg-0: #081120;        /* fondo app */
  --bg-1: #0D1B2E;        /* paneles */
  --surface: #12233A;     /* tarjetas */
  --line: #1E3A55;        /* bordes y divisores */

  /* texto */
  --text: #E8F0FA;        /* primario  (contraste ≥ 4.5:1 sobre --bg-*) */
  --text-muted: #93A8C4;  /* secundario (contraste ≥ 3:1) */

  /* marca / acción */
  --accent: #2DD4BF;          /* teal — acción primaria, foco, "en ruta" */
  --accent-strong: #14B8A6;

  /* estados de navegación (hgNavstate) — SIEMPRE acompañados de ícono + texto */
  --state-enroute: #2DD4BF;   /* 5 · En ruta */
  --state-ground:  #F5A524;   /* 4 · Emitiendo en tierra */
  --state-stopped: #7C8DA6;   /* 2 · Parado */
  --state-stale:   #EF4444;   /* sin señal reciente */

  /* foco accesible */
  --focus-ring: 0 0 0 3px rgba(45, 212, 191, .55);
}
```

Tipografía: display **Barlow Condensed** (titulares y rótulos de panel — registro
técnico/aeronáutico), cuerpo **Inter**, y **JetBrains Mono** para toda la telemetría
(coordenadas, altitud, velocidad, timestamps). Base 16 px, line-height 1.5.

**Elemento firma** (el único gesto expresivo; el resto, sobrio): el **pulso de frescura**.
Cada marcador de aeronave lleva un anillo que late suavemente mientras `freshness = "live"`
(< 2 min, el umbral de latencia del estándar AFF), se apaga a estático en "delayed" y pasa a
contorno rojo discontinuo en "stale". El anillo codifica una verdad operativa (¿puedo confiar
en este punto?), no es decoración. Respetar `prefers-reduced-motion`: sin animación, el estado
se muestra solo por color + etiqueta.

### 10.2 Layout

```
┌────────────────────────────────────────────────────────────────┐
│ StatusBar: ● Conectado · último dato hace 12 s · próximo poll  │
├──────────────┬─────────────────────────────────────────────────┤
│ FleetPanel   │                                                 │
│ ─────────    │                MapView (Leaflet)                │
│ ▸ PUMA-1  ✈  │   marcadores rotados por heading                │
│   En ruta    │   trails por ESN (polyline, color por estado)   │
│   hace 40 s  │   popup → ResourceDetail                        │
│ ▸ H-02    ▲  │                                                 │
│   En tierra  │                                                 │
├──────────────┴─────────────────────────────────────────────────┤
│ TimeRangeBar (modo histórico): [últimas 2 h ▾] [desde–hasta]   │
└────────────────────────────────────────────────────────────────┘
```

Responsive: bajo 900 px el FleetPanel colapsa a un drawer inferior; el mapa siempre a pantalla
completa detrás. Sin scroll horizontal en ningún breakpoint.

### 10.3 Reglas de calidad UI (obligatorias)

- Contraste WCAG AA: texto normal ≥ 4.5:1, texto grande e íconos ≥ 3:1 — verificar contra los
  tokens de fondo.
- El estado **nunca** se comunica solo por color: siempre color + ícono (lucide) + texto
  ("En ruta", "Emitiendo en tierra", "Parado", "Sin señal").
- Nada de emojis como íconos; una sola familia (lucide-react), stroke uniforme.
- Targets táctiles ≥ 44×44 px; foco de teclado visible en todo elemento interactivo
  (`--focus-ring`); orden de tabulación = orden visual.
- Micro-interacciones 150–300 ms; `prefers-reduced-motion` respetado globalmente.
- Estados de carga y error con dirección, no con disculpas: "Sin conexión con Nexe —
  reintentando en 20 s", "El contrato del body cambió: revisar §8.1 (detalle técnico abajo)".
- Estados vacíos accionables: "Aún no llegan posiciones para este rango. Amplía el rango o
  verifica que la flota esté operando."
- Espaciado en ritmo de 4/8 px; jerarquía vertical 16/24/32/48.
- Unidades siempre visibles y convertidas: velocidad en **km/h** (y nudos entre paréntesis),
  altitud en **m**; timestamps en hora de Chile con tooltip del valor UTC crudo.

### 10.4 Sistema implementado (extensiones sobre 10.1, jul-2026)

Decisiones de diseño ya construidas — mantener coherencia al extender:

- **Tokens extendidos** en `tokens.css`: radios (`--radius-s/m/l`), elevación (`--shadow-1/2`),
  vidrio (`--glass` + `backdrop-filter`), bordes suaves (`--line-soft`), variantes translúcidas
  por estado (`--accent-dim`, `--ground-dim`, `--stopped-dim`, `--stale-dim`) y `--accent-glow`.
  Sigue prohibido el hex crudo en componentes (única excepción: tokens.css).
- **StatusBar**: indicadores como *pills* (etiqueta muted + valor mono); la pill de conexión
  lleva halo teal solo cuando hay conexión. Banners con borde izquierdo en color semántico.
- **FleetPanel**: fila de **KPIs por estado** (conteo con cifra en tinta de texto e identidad
  en el ícono de color — regla dataviz) que además **filtran la lista** (aria-pressed);
  tarjetas de recurso con **riel izquierdo** en color de estado (redundante con el chip
  ícono+texto), patente como chip mono, selección con borde teal + glow. KPIs 2×2 en panel
  angosto, 4 columnas en el drawer móvil.
- **Mapa**: marcadores con halo suave; etiqueta flotante (Tooltip Leaflet en `--glass`) con
  **alias + texto de estado** al hover, fija en el seleccionado; zoom abajo a la derecha con
  targets de 44 px; tiles OSM atenuados para el tema nocturno (`filter` sobre el pane).
- **Gráficos** (MiniGrafico): una serie por gráfico con su propia escala — **nunca doble
  eje**; título nombra la serie (sin leyenda); punto final enfatizado; mín/máx como texto;
  grilla recesiva.
- **Targets Leaflet corregidos a ≥44 px** (zoom y cierre de popup) y `summary` de detalles
  técnicos a 44 px — los defaults de Leaflet NO cumplen §10.3.
- La frescura en filas del panel lleva `title`/`aria-label` con el texto ("En vivo"/"Con
  retraso"/"Sin señal") + hora UTC: el punto de color nunca queda solo.

---

## 11. Alcance funcional

### MVP (entregar primero, en este orden)

1. Proxy Express + cliente de datos + parser tolerante + polling con cursor `dataCtrTime`.
2. Mapa con la flota en vivo: marcadores rotados por `heading`, color/ícono por `hgNavstate`,
   pulso de frescura, popup con telemetría resumida.
3. FleetPanel: lista de recursos ordenada por frescura, con búsqueda por alias/patente y clic →
   centra el mapa en el recurso.
4. Trazas (trail) por recurso, activables por recurso o "todas", con tope de memoria (§8.3).
5. StatusBar con estado de conexión, cursor actual y cuenta regresiva del próximo poll.
6. Modo simulación contra `server/mock.ts` (banner visible).

### Fase 2 — IMPLEMENTADA (jul-2026)

7. ✔ Modo histórico: TimeRangeBar con rango libre (consulta única paginada a `/get`, sin
   polling; máx. 30 páginas con aviso de truncamiento; staleness relativo al fin del rango;
   sin la ventana de 6 h del buffer vivo). Hook: `src/hooks/useHistorico.ts`.
8. ✔ Export de lo visible: **GeoJSON** (FeatureCollection de Points con todas las propiedades)
   y **CSV** RFC 4180 con BOM — compatibles con QGIS y kepler.gl. `src/lib/exportar.ts`,
   botones en la TimeRangeBar.
9. ✔ Ficha ResourceDetail completa: sparklines de velocidad y altitud vs tiempo (una serie por
   gráfico, cada una con su escala — sin doble eje), calidad de señal (fix/PDOP/HDOP) y datos
   del medio. `src/components/ResourceDetail/MiniGrafico.tsx`.
10. ✔ Alertas visuales: toasts cuando un recurso pasa a "sin señal" o recupera señal
    (transiciones, no primera aparición; expiran a los 60 s). `src/domain/alertas.ts` +
    `src/hooks/useAlertas.ts`. El caso "FixType degradado sostenido" quedó fuera: `fix` es
    configuración de la baliza, no calidad puntual (§7.3).

### Fuera de alcance (no construir)

- Autenticación de usuarios de la app (se resuelve institucionalmente después).
- Persistencia en base de datos (todo en memoria del cliente por ahora).
- Edición/escritura hacia Nexe (la API es de solo lectura).

---

## 12. Testing

Con Vitest, como mínimo:

- `parse.ts`: fixtures de (a) lista directa, (b) objeto con `positions`, (c) objeto con clave
  desconocida que contiene la lista, (d) error `{detail: ...}` → debe lanzar error tipado,
  (e) respuesta del mock.
- `fleet.ts`: dedupe por `(esn, posTime)`; orden de trail por `posTime` con llegada desordenada;
  tope de buffer; cálculo de `freshness` en los tres umbrales.
- `usePolling`: el cursor avanza al `max(dataCtrTime)` y **nunca retrocede**; backoff ante 5xx;
  detención ante 401/422.
- `contract.ts`: los builders nunca producen listas vacías (regresión directa del 500 real).
- Componentes: FleetPanel renderiza los 3 estados + stale con ícono y texto (no solo color).

Fixtures en `tests/fixtures/`. Cuando exista la primera respuesta real de staging, guardarla
(anonimizada si hiciera falta) como fixture canónico.

---

## 13. Convenciones de código

- TypeScript estricto (`strict: true`); prohibido `any` (usar `unknown` + narrowing en el parser).
- Componentes funcionales con hooks; nada de clases.
- Nombres de dominio en español (`FleetPanel` ok como componente, pero `freshness`, `trail` y
  demás términos técnicos pueden quedar en inglés — consistencia ante todo). Textos de UI
  **siempre** en español, centralizados en `src/ui/strings.ts`.
- Commits convencionales (`feat:`, `fix:`, `docs:`...), mensajes en español.
- Un cambio de contrato de la API = un commit propio que toca `contract.ts` + este archivo.

---

## 14. Reglas duras para la IA (resumen ejecutivo)

1. **Nunca** llamar a Nexe desde el navegador. **Nunca** exponer la API key al cliente ni
   loguearla.
2. **Nunca** enviar `dataCenter` o `msgRequest` como listas vacías (500 confirmado).
3. `type` es exactamente `"dataRequest"`. El body se arma **solo** en `src/api/contract.ts`.
4. Si `nexe_bodies_descubiertos.json` existe, su contenido manda sobre las hipótesis de este
   archivo.
5. No fijar el parser de respuesta hasta ver un 200 real; mientras tanto, parser tolerante (§8.2).
6. Ante 422 del servidor: leer `detail[]`, corregir `contract.ts`, actualizar §2 de este archivo.
   Ante 500 persistente con forma válida: probar candidatos de `dataCenter` (§2) o escalar a Nexe.
7. Polling ≥ 30 s, cursor por `dataCtrTime`, dedupe por `(esn, posTime)`, cursor nunca retrocede.
8. UI en español (Chile), tema oscuro navy/teal por tokens, estado siempre con color + ícono +
   texto, WCAG AA, sin emojis como íconos, `prefers-reduced-motion` respetado.
9. Todo tiempo se intercambia en UTC y se **presenta** en `America/Santiago`.
10. Ante conflicto entre este archivo y la realidad del servidor: gana el servidor, y este
    archivo se actualiza en el mismo commit.

---

## 15. Glosario

| Término | Significado |
|---|---|
| **CONAF** | Corporación Nacional Forestal (Chile), a cargo del combate de incendios forestales |
| **CENCO / CENCOR** | Central de Coordinación (nacional/regional) de operaciones contra incendios |
| **SENAPRED** | Servicio Nacional de Prevención y Respuesta ante Desastres |
| **Nexe** | Plataforma de monitoreo de Heligrafics Chile SpA que provee esta API |
| **AFF** | Automated Flight Following — estándar del USDA Forest Service para seguimiento de aeronaves |
| **ESN** | Equipment Serial Number: nº de serie del dispositivo de seguimiento; clave del recurso |
| **Baliza** | Dispositivo satelital de seguimiento instalado en la aeronave |
| **Ala rotatoria / Ala fija** | Helicópteros / aviones |
| **posTime / dataCtrTime** | Hora de la posición / hora de llegada de esa posición al servidor Nexe |
| **Glosa, LE/LQ/LR, Mercado Público** | Terminología de compras públicas chilenas (contexto del contrato; no afecta al código) |

---

## 16. Referencias

- Swagger (staging): `https://staging.nexe.online/api/v1/monitor/docs`
- Esquema OpenAPI de la API (JSON): enlazado desde el propio Swagger UI — volcarlo al repo como
  `docs/nexe-openapi.json` (procedimiento y regla de precedencia en §2). **Es el documento que
  convierte este CLAUDE.md de "hipótesis verificadas" a "contrato cerrado".**
- PDF del estándar AFF: "Specification Section Supplement" (USDA Forest Service, 10/14/15) —
  enlazado desde el propio Swagger.
- Notebook de descubrimiento del contrato: `explorar_api_nexe_posiciones_v5.ipynb`
  (genera `nexe_bodies_descubiertos.json`).
- Extractor batch para análisis: `descargar_historico_nexe.py` (un CSV por día de Chile en
  `datos_historicos/` + catálogo de recursos; se salta días ya bajados, pausa entre páginas,
  y NO crea archivo en días vacíos — la copia de staging corre días detrás del presente).
- Contacto técnico Nexe: José Cartagenova (jcartagenova@heligrafics.net). Correos clave:
  2-jul-2026 (key de pruebas y descripción de los métodos) y 3-jul-2026 (ejemplos reales de
  request/response, semántica del filtro, límite ~1000, `domain`, respuestas a las 20 dudas).
- Soporte/incidencias del servicio: `soporte.monitor@heligrafics.net` (incluir detalle y ejemplo
  del problema). No existe endpoint de heartbeat.


  # UI/UX Pro Max - Design Intelligence

Comprehensive design guide for web and mobile applications. Contains 50+ styles, 161 color palettes, 57 font pairings, 161 product types with reasoning rules, 99 UX guidelines, and 25 chart types across 10 technology stacks. Searchable database with priority-based recommendations.

## When to Apply

This Skill should be used when the task involves **UI structure, visual design decisions, interaction patterns, or user experience quality control**.

### Must Use

This Skill must be invoked in the following situations:

- Designing new pages (Landing Page, Dashboard, Admin, SaaS, Mobile App)
- Creating or refactoring UI components (buttons, modals, forms, tables, charts, etc.)
- Choosing color schemes, typography systems, spacing standards, or layout systems
- Reviewing UI code for user experience, accessibility, or visual consistency
- Implementing navigation structures, animations, or responsive behavior
- Making product-level design decisions (style, information hierarchy, brand expression)
- Improving perceived quality, clarity, or usability of interfaces

### Recommended

This Skill is recommended in the following situations:

- UI looks "not professional enough" but the reason is unclear
- Receiving feedback on usability or experience
- Pre-launch UI quality optimization
- Aligning cross-platform design (Web / iOS / Android)
- Building design systems or reusable component libraries

### Skip

This Skill is not needed in the following situations:

- Pure backend logic development
- Only involving API or database design
- Performance optimization unrelated to the interface
- Infrastructure or DevOps work
- Non-visual scripts or automation tasks

**Decision criteria**: If the task will change how a feature **looks, feels, moves, or is interacted with**, this Skill should be used.

## Rule Categories by Priority

*For human/AI reference: follow priority 1→10 to decide which rule category to focus on first; use `--domain <Domain>` to query details when needed. Scripts do not read this table.*

| Priority | Category | Impact | Domain | Key Checks (Must Have) | Anti-Patterns (Avoid) |
|----------|----------|--------|--------|------------------------|------------------------|
| 1 | Accessibility | CRITICAL | `ux` | Contrast 4.5:1, Alt text, Keyboard nav, Aria-labels | Removing focus rings, Icon-only buttons without labels |
| 2 | Touch & Interaction | CRITICAL | `ux` | Min size 44×44px, 8px+ spacing, Loading feedback | Reliance on hover only, Instant state changes (0ms) |
| 3 | Performance | HIGH | `ux` | WebP/AVIF, Lazy loading, Reserve space (CLS &lt; 0.1) | Layout thrashing, Cumulative Layout Shift |
| 4 | Style Selection | HIGH | `style`, `product` | Match product type, Consistency, SVG icons (no emoji) | Mixing flat & skeuomorphic randomly, Emoji as icons |
| 5 | Layout & Responsive | HIGH | `ux` | Mobile-first breakpoints, Viewport meta, No horizontal scroll | Horizontal scroll, Fixed px container widths, Disable zoom |
| 6 | Typography & Color | MEDIUM | `typography`, `color` | Base 16px, Line-height 1.5, Semantic color tokens | Text &lt; 12px body, Gray-on-gray, Raw hex in components |
| 7 | Animation | MEDIUM | `ux` | Duration 150–300ms, Motion conveys meaning, Spatial continuity | Decorative-only animation, Animating width/height, No reduced-motion |
| 8 | Forms & Feedback | MEDIUM | `ux` | Visible labels, Error near field, Helper text, Progressive disclosure | Placeholder-only label, Errors only at top, Overwhelm upfront |
| 9 | Navigation Patterns | HIGH | `ux` | Predictable back, Bottom nav ≤5, Deep linking | Overloaded nav, Broken back behavior, No deep links |
| 10 | Charts & Data | LOW | `chart` | Legends, Tooltips, Accessible colors | Relying on color alone to convey meaning |

## Quick Reference

### 1. Accessibility (CRITICAL)

- `color-contrast` - Minimum 4.5:1 ratio for normal text (large text 3:1); Material Design
- `focus-states` - Visible focus rings on interactive elements (2–4px; Apple HIG, MD)
- `alt-text` - Descriptive alt text for meaningful images
- `aria-labels` - aria-label for icon-only buttons; accessibilityLabel in native (Apple HIG)
- `keyboard-nav` - Tab order matches visual order; full keyboard support (Apple HIG)
- `form-labels` - Use label with for attribute
- `skip-links` - Skip to main content for keyboard users
- `heading-hierarchy` - Sequential h1→h6, no level skip
- `color-not-only` - Don't convey info by color alone (add icon/text)
- `dynamic-type` - Support system text scaling; avoid truncation as text grows (Apple Dynamic Type, MD)
- `reduced-motion` - Respect prefers-reduced-motion; reduce/disable animations when requested (Apple Reduced Motion API, MD)
- `voiceover-sr` - Meaningful accessibilityLabel/accessibilityHint; logical reading order for VoiceOver/screen readers (Apple HIG, MD)
- `escape-routes` - Provide cancel/back in modals and multi-step flows (Apple HIG)
- `keyboard-shortcuts` - Preserve system and a11y shortcuts; offer keyboard alternatives for drag-and-drop (Apple HIG)

### 2. Touch & Interaction (CRITICAL)

- `touch-target-size` - Min 44×44pt (Apple) / 48×48dp (Material); extend hit area beyond visual bounds if needed
- `touch-spacing` - Minimum 8px/8dp gap between touch targets (Apple HIG, MD)
- `hover-vs-tap` - Use click/tap for primary interactions; don't rely on hover alone
- `loading-buttons` - Disable button during async operations; show spinner or progress
- `error-feedback` - Clear error messages near problem
- `cursor-pointer` - Add cursor-pointer to clickable elements (Web)
- `gesture-conflicts` - Avoid horizontal swipe on main content; prefer vertical scroll
- `tap-delay` - Use touch-action: manipulation to reduce 300ms delay (Web)
- `standard-gestures` - Use platform standard gestures consistently; don't redefine (e.g. swipe-back, pinch-zoom) (Apple HIG)
- `system-gestures` - Don't block system gestures (Control Center, back swipe, etc.) (Apple HIG)
- `press-feedback` - Visual feedback on press (ripple/highlight; MD state layers)
- `haptic-feedback` - Use haptic for confirmations and important actions; avoid overuse (Apple HIG)
- `gesture-alternative` - Don't rely on gesture-only interactions; always provide visible controls for critical actions
- `safe-area-awareness` - Keep primary touch targets away from notch, Dynamic Island, gesture bar and screen edges
- `no-precision-required` - Avoid requiring pixel-perfect taps on small icons or thin edges
- `swipe-clarity` - Swipe actions must show clear affordance or hint (chevron, label, tutorial)
- `drag-threshold` - Use a movement threshold before starting drag to avoid accidental drags

### 3. Performance (HIGH)

- `image-optimization` - Use WebP/AVIF, responsive images (srcset/sizes), lazy load non-critical assets
- `image-dimension` - Declare width/height or use aspect-ratio to prevent layout shift (Core Web Vitals: CLS)
- `font-loading` - Use font-display: swap/optional to avoid invisible text (FOIT); reserve space to reduce layout shift (MD)
- `font-preload` - Preload only critical fonts; avoid overusing preload on every variant
- `critical-css` - Prioritize above-the-fold CSS (inline critical CSS or early-loaded stylesheet)
- `lazy-loading` - Lazy load non-hero components via dynamic import / route-level splitting
- `bundle-splitting` - Split code by route/feature (React Suspense / Next.js dynamic) to reduce initial load and TTI
- `third-party-scripts` - Load third-party scripts async/defer; audit and remove unnecessary ones (MD)
- `reduce-reflows` - Avoid frequent layout reads/writes; batch DOM reads then writes
- `content-jumping` - Reserve space for async content to avoid layout jumps (Core Web Vitals: CLS)
- `lazy-load-below-fold` - Use loading="lazy" for below-the-fold images and heavy media
- `virtualize-lists` - Virtualize lists with 50+ items to improve memory efficiency and scroll performance
- `main-thread-budget` - Keep per-frame work under ~16ms for 60fps; move heavy tasks off main thread (HIG, MD)
- `progressive-loading` - Use skeleton screens / shimmer instead of long blocking spinners for >1s operations (Apple HIG)
- `input-latency` - Keep input latency under ~100ms for taps/scrolls (Material responsiveness standard)
- `tap-feedback-speed` - Provide visual feedback within 100ms of tap (Apple HIG)
- `debounce-throttle` - Use debounce/throttle for high-frequency events (scroll, resize, input)
- `offline-support` - Provide offline state messaging and basic fallback (PWA / mobile)
- `network-fallback` - Offer degraded modes for slow networks (lower-res images, fewer animations)

### 4. Style Selection (HIGH)

- `style-match` - Match style to product type (use `--design-system` for recommendations)
- `consistency` - Use same style across all pages
- `no-emoji-icons` - Use SVG icons (Heroicons, Lucide), not emojis
- `color-palette-from-product` - Choose palette from product/industry (search `--domain color`)
- `effects-match-style` - Shadows, blur, radius aligned with chosen style (glass / flat / clay etc.)
- `platform-adaptive` - Respect platform idioms (iOS HIG vs Material): navigation, controls, typography, motion
- `state-clarity` - Make hover/pressed/disabled states visually distinct while staying on-style (Material state layers)
- `elevation-consistent` - Use a consistent elevation/shadow scale for cards, sheets, modals; avoid random shadow values
- `dark-mode-pairing` - Design light/dark variants together to keep brand, contrast, and style consistent
- `icon-style-consistent` - Use one icon set/visual language (stroke width, corner radius) across the product
- `system-controls` - Prefer native/system controls over fully custom ones; only customize when branding requires it (Apple HIG)
- `blur-purpose` - Use blur to indicate background dismissal (modals, sheets), not as decoration (Apple HIG)
- `primary-action` - Each screen should have only one primary CTA; secondary actions visually subordinate (Apple HIG)

### 5. Layout & Responsive (HIGH)

- `viewport-meta` - width=device-width initial-scale=1 (never disable zoom)
- `mobile-first` - Design mobile-first, then scale up to tablet and desktop
- `breakpoint-consistency` - Use systematic breakpoints (e.g. 375 / 768 / 1024 / 1440)
- `readable-font-size` - Minimum 16px body text on mobile (avoids iOS auto-zoom)
- `line-length-control` - Mobile 35–60 chars per line; desktop 60–75 chars
- `horizontal-scroll` - No horizontal scroll on mobile; ensure content fits viewport width
- `spacing-scale` - Use 4pt/8dp incremental spacing system (Material Design)
- `touch-density` - Keep component spacing comfortable for touch: not cramped, not causing mis-taps
- `container-width` - Consistent max-width on desktop (max-w-6xl / 7xl)
- `z-index-management` - Define layered z-index scale (e.g. 0 / 10 / 20 / 40 / 100 / 1000)
- `fixed-element-offset` - Fixed navbar/bottom bar must reserve safe padding for underlying content
- `scroll-behavior` - Avoid nested scroll regions that interfere with the main scroll experience
- `viewport-units` - Prefer min-h-dvh over 100vh on mobile
- `orientation-support` - Keep layout readable and operable in landscape mode
- `content-priority` - Show core content first on mobile; fold or hide secondary content
- `visual-hierarchy` - Establish hierarchy via size, spacing, contrast — not color alone

### 6. Typography & Color (MEDIUM)

- `line-height` - Use 1.5-1.75 for body text
- `line-length` - Limit to 65-75 characters per line
- `font-pairing` - Match heading/body font personalities
- `font-scale` - Consistent type scale (e.g. 12 14 16 18 24 32)
- `contrast-readability` - Darker text on light backgrounds (e.g. slate-900 on white)
- `text-styles-system` - Use platform type system: iOS 11 Dynamic Type styles / Material 5 type roles (display, headline, title, body, label) (HIG, MD)
- `weight-hierarchy` - Use font-weight to reinforce hierarchy: Bold headings (600–700), Regular body (400), Medium labels (500) (MD)
- `color-semantic` - Define semantic color tokens (primary, secondary, error, surface, on-surface) not raw hex in components (Material color system)
- `color-dark-mode` - Dark mode uses desaturated / lighter tonal variants, not inverted colors; test contrast separately (HIG, MD)
- `color-accessible-pairs` - Foreground/background pairs must meet 4.5:1 (AA) or 7:1 (AAA); use tools to verify (WCAG, MD)
- `color-not-decorative-only` - Functional color (error red, success green) must include icon/text; avoid color-only meaning (HIG, MD)
- `truncation-strategy` - Prefer wrapping over truncation; when truncating use ellipsis and provide full text via tooltip/expand (Apple HIG)
- `letter-spacing` - Respect default letter-spacing per platform; avoid tight tracking on body text (HIG, MD)
- `number-tabular` - Use tabular/monospaced figures for data columns, prices, and timers to prevent layout shift
- `whitespace-balance` - Use whitespace intentionally to group related items and separate sections; avoid visual clutter (Apple HIG)

### 7. Animation (MEDIUM)

- `duration-timing` - Use 150–300ms for micro-interactions; complex transitions ≤400ms; avoid >500ms (MD)
- `transform-performance` - Use transform/opacity only; avoid animating width/height/top/left
- `loading-states` - Show skeleton or progress indicator when loading exceeds 300ms
- `excessive-motion` - Animate 1-2 key elements per view max
- `easing` - Use ease-out for entering, ease-in for exiting; avoid linear for UI transitions
- `motion-meaning` - Every animation must express a cause-effect relationship, not just be decorative (Apple HIG)
- `state-transition` - State changes (hover / active / expanded / collapsed / modal) should animate smoothly, not snap
- `continuity` - Page/screen transitions should maintain spatial continuity (shared element, directional slide) (Apple HIG)
- `parallax-subtle` - Use parallax sparingly; must respect reduced-motion and not cause disorientation (Apple HIG)
- `spring-physics` - Prefer spring/physics-based curves over linear or cubic-bezier for natural feel (Apple HIG fluid animations)
- `exit-faster-than-enter` - Exit animations shorter than enter (~60–70% of enter duration) to feel responsive (MD motion)
- `stagger-sequence` - Stagger list/grid item entrance by 30–50ms per item; avoid all-at-once or too-slow reveals (MD)
- `shared-element-transition` - Use shared element / hero transitions for visual continuity between screens (MD, HIG)
- `interruptible` - Animations must be interruptible; user tap/gesture cancels in-progress animation immediately (Apple HIG)
- `no-blocking-animation` - Never block user input during an animation; UI must stay interactive (Apple HIG)
- `fade-crossfade` - Use crossfade for content replacement within the same container (MD)
- `scale-feedback` - Subtle scale (0.95–1.05) on press for tappable cards/buttons; restore on release (HIG, MD)
- `gesture-feedback` - Drag, swipe, and pinch must provide real-time visual response tracking the finger (MD Motion)
- `hierarchy-motion` - Use translate/scale direction to express hierarchy: enter from below = deeper, exit upward = back (MD)
- `motion-consistency` - Unify duration/easing tokens globally; all animations share the same rhythm and feel
- `opacity-threshold` - Fading elements should not linger below opacity 0.2; either fade fully or remain visible
- `modal-motion` - Modals/sheets should animate from their trigger source (scale+fade or slide-in) for spatial context (HIG, MD)
- `navigation-direction` - Forward navigation animates left/up; backward animates right/down — keep direction logically consistent (HIG)
- `layout-shift-avoid` - Animations must not cause layout reflow or CLS; use transform for position changes

### 8. Forms & Feedback (MEDIUM)

- `input-labels` - Visible label per input (not placeholder-only)
- `error-placement` - Show error below the related field
- `submit-feedback` - Loading then success/error state on submit
- `required-indicators` - Mark required fields (e.g. asterisk)
- `empty-states` - Helpful message and action when no content
- `toast-dismiss` - Auto-dismiss toasts in 3-5s
- `confirmation-dialogs` - Confirm before destructive actions
- `input-helper-text` - Provide persistent helper text below complex inputs, not just placeholder (Material Design)
- `disabled-states` - Disabled elements use reduced opacity (0.38–0.5) + cursor change + semantic attribute (MD)
- `progressive-disclosure` - Reveal complex options progressively; don't overwhelm users upfront (Apple HIG)
- `inline-validation` - Validate on blur (not keystroke); show error only after user finishes input (MD)
- `input-type-keyboard` - Use semantic input types (email, tel, number) to trigger the correct mobile keyboard (HIG, MD)
- `password-toggle` - Provide show/hide toggle for password fields (MD)
- `autofill-support` - Use autocomplete / textContentType attributes so the system can autofill (HIG, MD)
- `undo-support` - Allow undo for destructive or bulk actions (e.g. "Undo delete" toast) (Apple HIG)
- `success-feedback` - Confirm completed actions with brief visual feedback (checkmark, toast, color flash) (MD)
- `error-recovery` - Error messages must include a clear recovery path (retry, edit, help link) (HIG, MD)
- `multi-step-progress` - Multi-step flows show step indicator or progress bar; allow back navigation (MD)
- `form-autosave` - Long forms should auto-save drafts to prevent data loss on accidental dismissal (Apple HIG)
- `sheet-dismiss-confirm` - Confirm before dismissing a sheet/modal with unsaved changes (Apple HIG)
- `error-clarity` - Error messages must state cause + how to fix (not just "Invalid input") (HIG, MD)
- `field-grouping` - Group related fields logically (fieldset/legend or visual grouping) (MD)
- `read-only-distinction` - Read-only state should be visually and semantically different from disabled (MD)
- `focus-management` - After submit error, auto-focus the first invalid field (WCAG, MD)
- `error-summary` - For multiple errors, show summary at top with anchor links to each field (WCAG)
- `touch-friendly-input` - Mobile input height ≥44px to meet touch target requirements (Apple HIG)
- `destructive-emphasis` - Destructive actions use semantic danger color (red) and are visually separated from primary actions (HIG, MD)
- `toast-accessibility` - Toasts must not steal focus; use aria-live="polite" for screen reader announcement (WCAG)
- `aria-live-errors` - Form errors use aria-live region or role="alert" to notify screen readers (WCAG)
- `contrast-feedback` - Error and success state colors must meet 4.5:1 contrast ratio (WCAG, MD)
- `timeout-feedback` - Request timeout must show clear feedback with retry option (MD)

### 9. Navigation Patterns (HIGH)

- `bottom-nav-limit` - Bottom navigation max 5 items; use labels with icons (Material Design)
- `drawer-usage` - Use drawer/sidebar for secondary navigation, not primary actions (Material Design)
- `back-behavior` - Back navigation must be predictable and consistent; preserve scroll/state (Apple HIG, MD)
- `deep-linking` - All key screens must be reachable via deep link / URL for sharing and notifications (Apple HIG, MD)
- `tab-bar-ios` - iOS: use bottom Tab Bar for top-level navigation (Apple HIG)
- `top-app-bar-android` - Android: use Top App Bar with navigation icon for primary structure (Material Design)
- `nav-label-icon` - Navigation items must have both icon and text label; icon-only nav harms discoverability (MD)
- `nav-state-active` - Current location must be visually highlighted (color, weight, indicator) in navigation (HIG, MD)
- `nav-hierarchy` - Primary nav (tabs/bottom bar) vs secondary nav (drawer/settings) must be clearly separated (MD)
- `modal-escape` - Modals and sheets must offer a clear close/dismiss affordance; swipe-down to dismiss on mobile (Apple HIG)
- `search-accessible` - Search must be easily reachable (top bar or tab); provide recent/suggested queries (MD)
- `breadcrumb-web` - Web: use breadcrumbs for 3+ level deep hierarchies to aid orientation (MD)
- `state-preservation` - Navigating back must restore previous scroll position, filter state, and input (HIG, MD)
- `gesture-nav-support` - Support system gesture navigation (iOS swipe-back, Android predictive back) without conflict (HIG, MD)
- `tab-badge` - Use badges on nav items sparingly to indicate unread/pending; clear after user visits (HIG, MD)
- `overflow-menu` - When actions exceed available space, use overflow/more menu instead of cramming (MD)
- `bottom-nav-top-level` - Bottom nav is for top-level screens only; never nest sub-navigation inside it (MD)
- `adaptive-navigation` - Large screens (≥1024px) prefer sidebar; small screens use bottom/top nav (Material Adaptive)
- `back-stack-integrity` - Never silently reset the navigation stack or unexpectedly jump to home (HIG, MD)
- `navigation-consistency` - Navigation placement must stay the same across all pages; don't change by page type
- `avoid-mixed-patterns` - Don't mix Tab + Sidebar + Bottom Nav at the same hierarchy level
- `modal-vs-navigation` - Modals must not be used for primary navigation flows; they break the user's path (HIG)
- `focus-on-route-change` - After page transition, move focus to main content region for screen reader users (WCAG)
- `persistent-nav` - Core navigation must remain reachable from deep pages; don't hide it entirely in sub-flows (HIG, MD)
- `destructive-nav-separation` - Dangerous actions (delete account, logout) must be visually and spatially separated from normal nav items (HIG, MD)
- `empty-nav-state` - When a nav destination is unavailable, explain why instead of silently hiding it (MD)

### 10. Charts & Data (LOW)

- `chart-type` - Match chart type to data type (trend → line, comparison → bar, proportion → pie/donut)
- `color-guidance` - Use accessible color palettes; avoid red/green only pairs for colorblind users (WCAG, MD)
- `data-table` - Provide table alternative for accessibility; charts alone are not screen-reader friendly (WCAG)
- `pattern-texture` - Supplement color with patterns, textures, or shapes so data is distinguishable without color (WCAG, MD)
- `legend-visible` - Always show legend; position near the chart, not detached below a scroll fold (MD)
- `tooltip-on-interact` - Provide tooltips/data labels on hover (Web) or tap (mobile) showing exact values (HIG, MD)
- `axis-labels` - Label axes with units and readable scale; avoid truncated or rotated labels on mobile
- `responsive-chart` - Charts must reflow or simplify on small screens (e.g. horizontal bar instead of vertical, fewer ticks)
- `empty-data-state` - Show meaningful empty state when no data exists ("No data yet" + guidance), not a blank chart (MD)
- `loading-chart` - Use skeleton or shimmer placeholder while chart data loads; don't show an empty axis frame
- `animation-optional` - Chart entrance animations must respect prefers-reduced-motion; data should be readable immediately (HIG)
- `large-dataset` - For 1000+ data points, aggregate or sample; provide drill-down for detail instead of rendering all (MD)
- `number-formatting` - Use locale-aware formatting for numbers, dates, currencies on axes and labels (HIG, MD)
- `touch-target-chart` - Interactive chart elements (points, segments) must have ≥44pt tap area or expand on touch (Apple HIG)
- `no-pie-overuse` - Avoid pie/donut for >5 categories; switch to bar chart for clarity
- `contrast-data` - Data lines/bars vs background ≥3:1; data text labels ≥4.5:1 (WCAG)
- `legend-interactive` - Legends should be clickable to toggle series visibility (MD)
- `direct-labeling` - For small datasets, label values directly on the chart to reduce eye travel
- `tooltip-keyboard` - Tooltip content must be keyboard-reachable and not rely on hover alone (WCAG)
- `sortable-table` - Data tables must support sorting with aria-sort indicating current sort state (WCAG)
- `axis-readability` - Axis ticks must not be cramped; maintain readable spacing, auto-skip on small screens
- `data-density` - Limit information density per chart to avoid cognitive overload; split into multiple charts if needed
- `trend-emphasis` - Emphasize data trends over decoration; avoid heavy gradients/shadows that obscure the data
- `gridline-subtle` - Grid lines should be low-contrast (e.g. gray-200) so they don't compete with data
- `focusable-elements` - Interactive chart elements (points, bars, slices) must be keyboard-navigable (WCAG)
- `screen-reader-summary` - Provide a text summary or aria-label describing the chart's key insight for screen readers (WCAG)
- `error-state-chart` - Data load failure must show error message with retry action, not a broken/empty chart
- `export-option` - For data-heavy products, offer CSV/image export of chart data
- `drill-down-consistency` - Drill-down interactions must maintain a clear back-path and hierarchy breadcrumb
- `time-scale-clarity` - Time series charts must clearly label time granularity (day/week/month) and allow switching

## How to Use

Search specific domains using the CLI tool below.

---

## Prerequisites

Check if Python is installed:

```bash
python3 --version || python --version
```

If Python is not installed, install it based on user's OS:

**macOS:**
```bash
brew install python3
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install python3
```

**Windows:**
```powershell
winget install Python.Python.3.12
```

> **Note:** On Windows, use `python` instead of `python3` to run scripts (e.g., `python scripts/search.py` instead of `python3 scripts/search.py`).

---

## How to Use This Skill

Use this skill when the user requests any of the following:

| Scenario | Trigger Examples | Start From |
|----------|-----------------|------------|
| **New project / page** | "Build a landing page", "Build a dashboard" | Step 1 → Step 2 (design system) |
| **New component** | "Create a pricing card", "Add a modal" | Step 3 (domain search: style, ux) |
| **Choose style / color / font** | "What style fits a fintech app?", "Recommend a color palette" | Step 2 (design system) |
| **Review existing UI** | "Review this page for UX issues", "Check accessibility" | Quick Reference checklist above |
| **Fix a UI bug** | "Button hover is broken", "Layout shifts on load" | Quick Reference → relevant section |
| **Improve / optimize** | "Make this faster", "Improve mobile experience" | Step 3 (domain search: ux, react) |
| **Implement dark mode** | "Add dark mode support" | Step 3 (domain: style "dark mode") |
| **Add charts / data viz** | "Add an analytics dashboard chart" | Step 3 (domain: chart) |
| **Stack best practices** | "React performance tips"、"SwiftUI navigation" | Step 4 (stack search) |

Follow this workflow:

### Step 1: Analyze User Requirements

Extract key information from user request:
- **Product type**: Entertainment (social, video, music, gaming), Tool (scanner, editor, converter), Productivity (task manager, notes, calendar), or hybrid
- **Target audience**: C-end consumer users; consider age group, usage context (commute, leisure, work)
- **Style keywords**: playful, vibrant, minimal, dark mode, content-first, immersive, etc.
- **Stack**: Match the project's framework. The engine ships guidance for many stacks (see [Available Stacks](#available-stacks) below) — pass the matching `--stack` (e.g. `nextjs`, `react`, `shadcn`, `vue`, `svelte`, `astro`, `swiftui`, `flutter`, `react-native`).

### Step 2: Generate Design System (REQUIRED)

**Always start with `--design-system`** to get comprehensive recommendations with reasoning:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <keywords>" --design-system [-p "Project Name"]
```

This command:
1. Searches domains in parallel (product, style, color, landing, typography)
2. Applies reasoning rules from `ui-reasoning.csv` to select best matches
3. Returns complete design system: pattern, style, colors, typography, effects
4. Includes anti-patterns to avoid

**Example:**
```bash
python3 skills/ui-ux-pro-max/scripts/search.py "beauty spa wellness service" --design-system -p "Serenity Spa"
```

### Step 2b: Persist Design System (Master + Overrides Pattern)

To save the design system for **hierarchical retrieval across sessions**, add `--persist`:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --persist -p "Project Name"
```

This creates:
- `design-system/MASTER.md` — Global Source of Truth with all design rules
- `design-system/pages/` — Folder for page-specific overrides

**With page-specific override:**
```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --persist -p "Project Name" --page "dashboard"
```

This also creates:
- `design-system/pages/dashboard.md` — Page-specific deviations from Master

**How hierarchical retrieval works:**
1. When building a specific page (e.g., "Checkout"), first check `design-system/pages/checkout.md`
2. If the page file exists, its rules **override** the Master file
3. If not, use `design-system/MASTER.md` exclusively

**Context-aware retrieval prompt:**
```
I am building the [Page Name] page. Please read design-system/MASTER.md.
Also check if design-system/pages/[page-name].md exists.
If the page file exists, prioritize its rules.
If not, use the Master rules exclusively.
Now, generate the code...
```

### Step 2c: Design Dials (optional)

Three optional 1-10 sliders that tune `--design-system` output without changing your query. Add any combination of them to the same command:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --variance <1-10> --motion <1-10> --density <1-10>
```

| Dial | Low (1-3) | Mid (4-7) | High (8-10) |
|------|-----------|-----------|-------------|
| `--variance` | Centered / minimal (biases toward Minimalism-style categories) | Balanced / modern | Bold / asymmetric (biases toward Brutalism, Bento Grids) |
| `--motion` | Subtle micro-interactions | Standard scroll/stagger motion | Complex choreography (pin, Flip, SplitText) |
| `--density` | Spacious (24-96px spacing scale) | Standard (16-64px, current default) | Dense/dashboard (8-32px spacing scale) |

- `--motion` attaches a ready-to-use GSAP snippet (with framework notes, Do/Don't, and performance notes) pulled from `--domain gsap`, matched to the resolved tier (Subtle/Standard/Complex).
- `--density` overrides the `--space-*` CSS variable table in the ASCII/markdown/MASTER.md output — use it for dashboards (high) vs. marketing pages (low) without hand-editing tokens.
- Leaving a dial unset keeps that part of the output exactly as it was before (no behavior change).

**Example:**
```bash
python3 skills/ui-ux-pro-max/scripts/search.py "internal analytics dashboard" --design-system --variance 8 --motion 7 --density 8 -p "Ops Console"
```

### Step 3: Supplement with Detailed Searches (as needed)

After getting the design system, use domain searches to get additional details:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <domain> [-n <max_results>]
```

**When to use detailed searches:**

| Need | Domain | Example |
|------|--------|---------|
| Product type patterns | `product` | `--domain product "entertainment social"` |
| More style options | `style` | `--domain style "glassmorphism dark"` |
| Color palettes | `color` | `--domain color "entertainment vibrant"` |
| Font pairings | `typography` | `--domain typography "playful modern"` |
| Chart recommendations | `chart` | `--domain chart "real-time dashboard"` |
| UX best practices | `ux` | `--domain ux "animation accessibility"` |
| Alternative fonts | `typography` | `--domain typography "elegant luxury"` |
| Individual Google Fonts | `google-fonts` | `--domain google-fonts "sans serif popular variable"` |
| Landing structure | `landing` | `--domain landing "hero social-proof"` |
| React Native perf | `react` | `--domain react "rerender memo list"` |
| App interface a11y | `web` | `--domain web "accessibilityLabel touch safe-areas"` |
| AI prompt / CSS keywords | `prompt` | `--domain prompt "minimalism"` |

### Step 4: Stack Guidelines (match your framework)

Get implementation-specific best practices for the stack you're building in.
Pass the `--stack` that matches the project's framework:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<keyword>" --stack <your-stack>
# e.g. --stack nextjs | react | shadcn | vue | svelte | astro | swiftui | flutter | react-native
```

---

## Search Reference

### Available Domains

| Domain | Use For | Example Keywords |
|--------|---------|------------------|
| `product` | Product type recommendations | SaaS, e-commerce, portfolio, healthcare, beauty, service |
| `style` | UI styles, colors, effects | glassmorphism, minimalism, dark mode, brutalism |
| `typography` | Font pairings, Google Fonts | elegant, playful, professional, modern |
| `color` | Color palettes by product type | saas, ecommerce, healthcare, beauty, fintech, service |
| `landing` | Page structure, CTA strategies | hero, hero-centric, testimonial, pricing, social-proof |
| `chart` | Chart types, library recommendations | trend, comparison, timeline, funnel, pie |
| `ux` | Best practices, anti-patterns | animation, accessibility, z-index, loading |
| `gsap` | GSAP animation skeletons by intensity tier | scroll reveal, stagger, magnetic cursor, page transition |
| `google-fonts` | Individual Google Fonts lookup | sans serif, monospace, japanese, variable font, popular |
| `react` | React/Next.js performance | waterfall, bundle, suspense, memo, rerender, cache |
| `web` | App interface guidelines (iOS/Android/React Native) | accessibilityLabel, touch targets, safe areas, Dynamic Type |
| `prompt` | AI prompts, CSS keywords | (style name) |

### Available Stacks

Run `ls <skill>/data/stacks/` to see the live set. Shipped stacks:

| Stack | Focus |
|-------|-------|
| `react` | Components, hooks, render performance |
| `nextjs` | App Router, RSC, Server Actions, rendering |
| `vue` | Components, Composition API, reactivity |
| `nuxtjs` | Nuxt app patterns, SSR data fetching |
| `nuxt-ui` | Nuxt UI component patterns |
| `svelte` | Components, stores, transitions |
| `astro` | Islands, content, partial hydration |
| `shadcn` | shadcn/ui primitives, composition |
| `html-tailwind` | Tailwind utility patterns |
| `angular` | Components, signals, services |
| `laravel` | Blade / server-rendered UI patterns |
| `swiftui` | Views, state, navigation (iOS/macOS) |
| `flutter` | Widgets, state, navigation |
| `jetpack-compose` | Composables, state, navigation (Android) |
| `react-native` | Components, Navigation, Lists |
| `threejs` | 3D scenes, materials, performance |

---

## Example Workflow

**User request:** "Make an AI search homepage."

### Step 1: Analyze Requirements
- Product type: Tool (AI search engine)
- Target audience: C-end users looking for fast, intelligent search
- Style keywords: modern, minimal, content-first, dark mode
- Stack: Next.js (a homepage is a web surface; use a web `--stack`)

### Step 2: Generate Design System (REQUIRED)

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "AI search tool modern minimal" --design-system -p "AI Search"
```

**Output:** Complete design system with pattern, style, colors, typography, effects, and anti-patterns.

### Step 3: Supplement with Detailed Searches (as needed)

```bash
# Get style options for a modern tool product
python3 skills/ui-ux-pro-max/scripts/search.py "minimalism dark mode" --domain style

# Get UX best practices for search interaction and loading
python3 skills/ui-ux-pro-max/scripts/search.py "search loading animation" --domain ux
```

### Step 4: Stack Guidelines

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "list performance navigation" --stack nextjs
```

**Then:** Synthesize design system + detailed searches and implement the design.

---

## Output Formats

The `--design-system` flag supports two output formats:

```bash
# ASCII box (default) - best for terminal display
python3 skills/ui-ux-pro-max/scripts/search.py "fintech crypto" --design-system

# Markdown - best for documentation
python3 skills/ui-ux-pro-max/scripts/search.py "fintech crypto" --design-system -f markdown
```

---

## Tips for Better Results

### Query Strategy

- Use **multi-dimensional keywords** — combine product + industry + tone + density: `"entertainment social vibrant content-dense"` not just `"app"`
- Try different keywords for the same need: `"playful neon"` → `"vibrant dark"` → `"content-first minimal"`
- Use `--design-system` first for full recommendations, then `--domain` to deep-dive any dimension you're unsure about
- Add the `--stack` that matches the project's framework for implementation-specific guidance

### Common Sticking Points

| Problem | What to Do |
|---------|------------|
| Can't decide on style/color | Re-run `--design-system` with different keywords |
| Dark mode contrast issues | Quick Reference §6: `color-dark-mode` + `color-accessible-pairs` |
| Animations feel unnatural | Quick Reference §7: `spring-physics` + `easing` + `exit-faster-than-enter` |
| Form UX is poor | Quick Reference §8: `inline-validation` + `error-clarity` + `focus-management` |
| Navigation feels confusing | Quick Reference §9: `nav-hierarchy` + `bottom-nav-limit` + `back-behavior` |
| Layout breaks on small screens | Quick Reference §5: `mobile-first` + `breakpoint-consistency` |
| Performance / jank | Quick Reference §3: `virtualize-lists` + `main-thread-budget` + `debounce-throttle` |

### Pre-Delivery Checklist

- Run `--domain ux "animation accessibility z-index loading"` as a UX validation pass before implementation
- Run through Quick Reference **§1–§3** (CRITICAL + HIGH) as a final review
- Test on 375px (small phone) and landscape orientation
- Verify behavior with **reduced-motion** enabled and **Dynamic Type** at largest size
- Check dark mode contrast independently (don't assume light mode values work)
- Confirm all touch targets ≥44pt and no content hidden behind safe areas

---

## Common Rules for Professional UI

These are frequently overlooked issues that make UI look unprofessional:
Scope notice: The rules below are for App UI (iOS/Android/React Native/Flutter), not desktop-web interaction patterns.

### Icons & Visual Elements

| Rule | Standard | Avoid | Why It Matters |
|------|----------|--------|----------------|
| **No Emoji as Structural Icons** | Use vector-based icons (e.g., Lucide, react-native-vector-icons, @expo/vector-icons). | Using emojis (🎨 🚀 ⚙️) for navigation, settings, or system controls. | Emojis are font-dependent, inconsistent across platforms, and cannot be controlled via design tokens. |
| **Vector-Only Assets** | Use SVG or platform vector icons that scale cleanly and support theming. | Raster PNG icons that blur or pixelate. | Ensures scalability, crisp rendering, and dark/light mode adaptability. |
| **Stable Interaction States** | Use color, opacity, or elevation transitions for press states without changing layout bounds. | Layout-shifting transforms that move surrounding content or trigger visual jitter. | Prevents unstable interactions and preserves smooth motion/perceived quality on mobile. |
| **Correct Brand Logos** | Use official brand assets and follow their usage guidelines (spacing, color, clear space). | Guessing logo paths, recoloring unofficially, or modifying proportions. | Prevents brand misuse and ensures legal/platform compliance. |
| **Consistent Icon Sizing** | Define icon sizes as design tokens (e.g., icon-sm, icon-md = 24pt, icon-lg). | Mixing arbitrary values like 20pt / 24pt / 28pt randomly. | Maintains rhythm and visual hierarchy across the interface. |
| **Stroke Consistency** | Use a consistent stroke width within the same visual layer (e.g., 1.5px or 2px). | Mixing thick and thin stroke styles arbitrarily. | Inconsistent strokes reduce perceived polish and cohesion. |
| **Filled vs Outline Discipline** | Use one icon style per hierarchy level. | Mixing filled and outline icons at the same hierarchy level. | Maintains semantic clarity and stylistic coherence. |
| **Touch Target Minimum** | Minimum 44×44pt interactive area (use hitSlop if icon is smaller). | Small icons without expanded tap area. | Meets accessibility and platform usability standards. |
| **Icon Alignment** | Align icons to text baseline and maintain consistent padding. | Misaligned icons or inconsistent spacing around them. | Prevents subtle visual imbalance that reduces perceived quality. |
| **Icon Contrast** | Follow WCAG contrast standards: 4.5:1 for small elements, 3:1 minimum for larger UI glyphs. | Low-contrast icons that blend into the background. | Ensures accessibility in both light and dark modes. |


### Interaction (App)

| Rule | Do | Don't |
|------|----|----- |
| **Tap feedback** | Provide clear pressed feedback (ripple/opacity/elevation) within 80-150ms | No visual response on tap |
| **Animation timing** | Keep micro-interactions around 150-300ms with platform-native easing | Instant transitions or slow animations (>500ms) |
| **Accessibility focus** | Ensure screen reader focus order matches visual order and labels are descriptive | Unlabeled controls or confusing focus traversal |
| **Disabled state clarity** | Use disabled semantics (`disabled`/native disabled props), reduced emphasis, and no tap action | Controls that look tappable but do nothing |
| **Touch target minimum** | Keep tap areas >=44x44pt (iOS) or >=48x48dp (Android), expand hit area when icon is smaller | Tiny tap targets or icon-only hit areas without padding |
| **Gesture conflict prevention** | Keep one primary gesture per region and avoid nested tap/drag conflicts | Overlapping gestures causing accidental actions |
| **Semantic native controls** | Prefer native interactive primitives (`Button`, `Pressable`, platform equivalents) with proper accessibility roles | Generic containers used as primary controls without semantics |

### Light/Dark Mode Contrast

| Rule | Do | Don't |
|------|----|----- |
| **Surface readability (light)** | Keep cards/surfaces clearly separated from background with sufficient opacity/elevation | Overly transparent surfaces that blur hierarchy |
| **Text contrast (light)** | Maintain body text contrast >=4.5:1 against light surfaces | Low-contrast gray body text |
| **Text contrast (dark)** | Maintain primary text contrast >=4.5:1 and secondary text >=3:1 on dark surfaces | Dark mode text that blends into background |
| **Border and divider visibility** | Ensure separators are visible in both themes (not just light mode) | Theme-specific borders disappearing in one mode |
| **State contrast parity** | Keep pressed/focused/disabled states equally distinguishable in light and dark themes | Defining interaction states for one theme only |
| **Token-driven theming** | Use semantic color tokens mapped per theme across app surfaces/text/icons | Hardcoded per-screen hex values |
| **Scrim and modal legibility** | Use a modal scrim strong enough to isolate foreground content (typically 40-60% black) | Weak scrim that leaves background visually competing |

### Layout & Spacing

| Rule | Do | Don't |
|------|----|----- |
| **Safe-area compliance** | Respect top/bottom safe areas for all fixed headers, tab bars, and CTA bars | Placing fixed UI under notch, status bar, or gesture area |
| **System bar clearance** | Add spacing for status/navigation bars and gesture home indicator | Let tappable content collide with OS chrome |
| **Consistent content width** | Keep predictable content width per device class (phone/tablet) | Mixing arbitrary widths between screens |
| **8dp spacing rhythm** | Use a consistent 4/8dp spacing system for padding/gaps/section spacing | Random spacing increments with no rhythm |
| **Readable text measure** | Keep long-form text readable on large devices (avoid edge-to-edge paragraphs on tablets) | Full-width long text that hurts readability |
| **Section spacing hierarchy** | Define clear vertical rhythm tiers (e.g., 16/24/32/48) by hierarchy | Similar UI levels with inconsistent spacing |
| **Adaptive gutters by breakpoint** | Increase horizontal insets on larger widths and in landscape | Same narrow gutter on all device sizes/orientations |
| **Scroll and fixed element coexistence** | Add bottom/top content insets so lists are not hidden behind fixed bars | Scroll content obscured by sticky headers/footers |

---

## Pre-Delivery Checklist

Before delivering UI code, verify these items:
Scope notice: This checklist is for App UI (iOS/Android/React Native/Flutter).

### Visual Quality
- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons come from a consistent icon family and style
- [ ] Official brand assets are used with correct proportions and clear space
- [ ] Pressed-state visuals do not shift layout bounds or cause jitter
- [ ] Semantic theme tokens are used consistently (no ad-hoc per-screen hardcoded colors)

### Interaction
- [ ] All tappable elements provide clear pressed feedback (ripple/opacity/elevation)
- [ ] Touch targets meet minimum size (>=44x44pt iOS, >=48x48dp Android)
- [ ] Micro-interaction timing stays in the 150-300ms range with native-feeling easing
- [ ] Disabled states are visually clear and non-interactive
- [ ] Screen reader focus order matches visual order, and interactive labels are descriptive
- [ ] Gesture regions avoid nested/conflicting interactions (tap/drag/back-swipe conflicts)

### Light/Dark Mode
- [ ] Primary text contrast >=4.5:1 in both light and dark mode
- [ ] Secondary text contrast >=3:1 in both light and dark mode
- [ ] Dividers/borders and interaction states are distinguishable in both modes
- [ ] Modal/drawer scrim opacity is strong enough to preserve foreground legibility (typically 40-60% black)
- [ ] Both themes are tested before delivery (not inferred from a single theme)

### Layout
- [ ] Safe areas are respected for headers, tab bars, and bottom CTA bars
- [ ] Scroll content is not hidden behind fixed/sticky bars
- [ ] Verified on small phone, large phone, and tablet (portrait + landscape)
- [ ] Horizontal insets/gutters adapt correctly by device size and orientation
- [ ] 4/8dp spacing rhythm is maintained across component, section, and page levels
- [ ] Long-form text measure remains readable on larger devices (no edge-to-edge paragraphs)

### Accessibility
- [ ] All meaningful images/icons have accessibility labels
- [ ] Form fields have labels, hints, and clear error messages
- [ ] Color is not the only indicator
- [ ] Reduced motion and dynamic text size are supported without layout breakage
- [ ] Accessibility traits/roles/states (selected, disabled, expanded) are announced correctly
