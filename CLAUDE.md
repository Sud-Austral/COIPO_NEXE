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

Estructura de carpetas objetivo:

```
/
├── CLAUDE.md                  ← este archivo
├── nexe_bodies_descubiertos.json   ← si existe, fuente de verdad del body (generado por el notebook)
├── server/
│   ├── index.ts               ← proxy Express (allowlist, api-key, timeouts)
│   └── mock.ts                ← servidor simulado para desarrollo sin key (§9)
├── src/
│   ├── api/
│   │   ├── contract.ts        ← builders del body + tipos de request (ÚNICO lugar donde se arma el body)
│   │   ├── client.ts          ← fetch al proxy, manejo de errores tipado
│   │   └── parse.ts           ← parser tolerante de la respuesta (§8.2)
│   ├── domain/
│   │   ├── types.ts           ← tipos del dominio (§8.4)
│   │   └── fleet.ts           ← agregación por ESN, dedupe, staleness, trails
│   ├── hooks/
│   │   └── usePolling.ts      ← ciclo de polling con dataCtrTime (§8.3)
│   ├── components/
│   │   ├── MapView/           ← mapa, marcadores rotados por heading, trails
│   │   ├── FleetPanel/        ← lista lateral de recursos con estado y frescura
│   │   ├── ResourceDetail/    ← ficha de un recurso (telemetría completa)
│   │   ├── TimeRangeBar/      ← modo histórico: selector de rango
│   │   └── StatusBar/         ← conexión, último dataCtrTime, contador de polling
│   ├── styles/tokens.css      ← design tokens (§10.1)
│   └── main.tsx / App.tsx
├── tests/                     ← fixtures + unit tests
├── .env.example               ← plantilla (NUNCA commitear .env real)
└── vite.config.ts
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

### Fase 2

7. Modo histórico: TimeRangeBar con rango libre (consulta única a `/get`, sin polling).
8. Export de lo visible: **GeoJSON** (FeatureCollection de Points con todas las propiedades) y
   **CSV** — compatibles con QGIS y kepler.gl.
9. Ficha ResourceDetail completa: gráfico simple de altitud/velocidad vs tiempo, calidad de señal
   (FixType/PDOP/HDOP), datos de la aeronave (`hgAssetModel`, `hgCompany`, `hgSource`).
10. Alertas visuales: recurso pasa a "stale", o `FixType` degradado sostenido.

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
- Contacto técnico Nexe: José Cartagenova (jcartagenova@heligrafics.net). Correos clave:
  2-jul-2026 (key de pruebas y descripción de los métodos) y 3-jul-2026 (ejemplos reales de
  request/response, semántica del filtro, límite ~1000, `domain`, respuestas a las 20 dudas).
- Soporte/incidencias del servicio: `soporte.monitor@heligrafics.net` (incluir detalle y ejemplo
  del problema). No existe endpoint de heartbeat.
