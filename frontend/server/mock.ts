/**
 * Servidor simulado de Nexe (CLAUDE.md §9) — para desarrollar sin key ni staging.
 *
 * Replica el contrato CONFIRMADO (correo 3-jul-2026): POST + header `api-key`,
 * 422 estilo Pydantic, 500 con listas vacías, respuesta GeoJSON
 * FeatureCollection con coordenadas [lon, lat], límite 1000 por respuesta,
 * filtro estrictamente `>` por dataCtrTime, campos hg* completos SOLO en
 * get_lastpositions (en /get solo telemetría + hgExtName) y hgNavstate como
 * string. Flota ficticia (aeronaves + un medio terrestre) sobre trayectorias
 * sintéticas en la zona centro-sur de Chile, marcada con hgCompany "SIMULADO".
 *
 * Flags por env: MOCK_PORT (3002), MOCK_FAIL_RATE (prob. de 500), MOCK_LATENCY_MS.
 */
import 'dotenv/config'
import express from 'express'
import { validarBodyNexe } from './validacionNexe'

const app = express()
app.use(express.json())

const PORT = Number(process.env.MOCK_PORT ?? 3002)
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE ?? 0)
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0)

const PASO_REPORTE_MS = 120_000 // una posición cada ~2 min (estándar AFF)
const LIMITE_RESPUESTA = 1000 // límite real del servidor Nexe

// ── Flota ficticia ────────────────────────────────────────────────────────────

interface MedioSimulado {
  esn: string
  hgExtName: string
  hgAlias: string
  hgAsset: string // patente
  hgAssetModel: string
  hgAssetFamily: string
  hgFamilyType: 'rotary' | 'fixed' | 'ground' | 'people'
  hgSource: string
  fix: '3D' | '2D' // configuración de la baliza (no calidad puntual)
  /** centro de su circuito o posición fija [lat, lon] */
  base: [number, number]
  /** radio del circuito en grados (~0.09° ≈ 10 km); 0 = no se mueve */
  radio: number
  /** m/s cuando se mueve */
  velocidadCrucero: number
  guion: 'volando' | 'ciclo-vuelo-tierra' | 'emitiendo-tierra' | 'detenida-sin-senal' | 'parado'
}

const FLOTA: MedioSimulado[] = [
  {
    esn: '300234061111010',
    hgExtName: 'HT-01',
    hgAlias: 'Helicóptero Talca',
    hgAsset: 'CC-AQY',
    hgAssetModel: 'Bell 412EP',
    hgAssetFamily: 'Ala rotatoria',
    hgFamilyType: 'rotary',
    hgSource: 'Iridium',
    fix: '3D',
    base: [-35.43, -71.65],
    radio: 0.09,
    velocidadCrucero: 52,
    guion: 'ciclo-vuelo-tierra',
  },
  {
    esn: '300234061111020',
    hgExtName: 'HT-02',
    hgAlias: 'Helicóptero Chillán',
    hgAsset: 'CC-ABH',
    hgAssetModel: 'Sikorsky S-61N',
    hgAssetFamily: 'Ala rotatoria',
    hgFamilyType: 'rotary',
    hgSource: 'Iridium',
    fix: '3D',
    base: [-36.59, -72.03],
    radio: 0,
    velocidadCrucero: 0,
    guion: 'emitiendo-tierra',
  },
  {
    esn: '300234061111030',
    hgExtName: 'AT-01',
    hgAlias: 'Avión Los Ángeles',
    hgAsset: 'CC-PVR',
    hgAssetModel: 'Air Tractor AT-802F',
    hgAssetFamily: 'Ala fija',
    hgFamilyType: 'fixed',
    hgSource: 'Iridium',
    fix: '3D',
    base: [-37.35, -72.1],
    radio: 0.16,
    velocidadCrucero: 72,
    guion: 'volando',
  },
  {
    esn: '300234061111040',
    hgExtName: 'AT-02',
    hgAlias: 'Avión Curicó',
    hgAsset: 'CC-PWT',
    hgAssetModel: 'PZL M18B Dromader',
    hgAssetFamily: 'Ala fija',
    hgFamilyType: 'fixed',
    hgSource: 'Globalstar',
    fix: '3D',
    base: [-34.97, -71.22],
    radio: 0,
    velocidadCrucero: 0,
    guion: 'detenida-sin-senal',
  },
  {
    // staging real incluye medios terrestres — el mock también (CLAUDE.md §9)
    esn: '867144061111050',
    hgExtName: 'MV-01',
    hgAlias: 'Móvil Ñuble 3',
    hgAsset: 'VXTK-21',
    hgAssetModel: 'Nissan Navara',
    hgAssetFamily: 'Coches',
    hgFamilyType: 'ground',
    hgSource: 'Star Connect GPS',
    fix: '2D',
    base: [-36.61, -72.1],
    radio: 0,
    velocidadCrucero: 0,
    guion: 'parado',
  },
]

// ── PRNG determinista ────────────────────────────────────────────────────────
// Misma (esn, posTime) → misma posición y misma latencia en TODAS las llamadas;
// sin esto, el dedupe del cliente vería puntos "distintos" en cada poll.

function hashSemilla(texto: string): number {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function aleatorio01(semilla: string): number {
  let t = hashSemilla(semilla) + 0x6d2b79f5
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ── Generador de posiciones ──────────────────────────────────────────────────

interface PosicionSimulada {
  medio: MedioSimulado
  posTimeMs: number
  dataCtrTimeMs: number
  lat: number
  lon: number
  alt: number | null
  spd: number
  cog: number
  navstate: 2 | 4 | 5
}

/** Estado en el instante t (ciclos de 50 min: 40 vuelo + 10 en tierra). */
function estadoEnInstante(m: MedioSimulado, tMs: number): 2 | 4 | 5 {
  switch (m.guion) {
    case 'volando':
      return 5
    case 'emitiendo-tierra':
      return 4
    case 'detenida-sin-senal':
    case 'parado':
      return 2
    case 'ciclo-vuelo-tierra': {
      const cicloMs = 50 * 60_000
      const fase = ((tMs % cicloMs) + cicloMs) % cicloMs
      return fase < 40 * 60_000 ? 5 : 4
    }
  }
}

function posicionEnInstante(m: MedioSimulado, tMs: number): PosicionSimulada | null {
  // AT-02 quedó muda: su baliza dejó de transmitir hace ~9 min respecto de "ahora".
  if (m.guion === 'detenida-sin-senal' && tMs > Date.now() - 9 * 60_000) return null

  const navstate = estadoEnInstante(m, tMs)
  const volando = navstate === 5 && m.radio > 0

  let lat = m.base[0]
  let lon = m.base[1]
  let cog = Math.round(aleatorio01(`${m.esn}|cog0`) * 359)
  let spd = 0
  let alt: number | null = null

  if (volando) {
    // Circuito circular: velocidad angular derivada de la velocidad de crucero.
    // 1° lat ≈ 111 km → radio en metros ≈ radio° · 111000.
    const radioM = m.radio * 111_000
    const velocidadAngular = m.velocidadCrucero / radioM // rad/s
    const angulo = (tMs / 1000) * velocidadAngular
    lat = m.base[0] + m.radio * Math.sin(angulo)
    lon = m.base[1] + (m.radio * Math.cos(angulo)) / Math.cos((m.base[0] * Math.PI) / 180)
    // tangente al círculo
    cog = Math.round(((Math.atan2(-Math.sin(angulo), Math.cos(angulo)) * 180) / Math.PI + 360) % 360)
    spd = Math.max(0, Math.round(m.velocidadCrucero + (aleatorio01(`${m.esn}|v|${tMs}`) - 0.5) * 8))
    alt = 450 + Math.round(aleatorio01(`${m.esn}|alt|${tMs}`) * 400)
  }

  // Latencia de llegada al servidor: 20–100 s; 1 de cada 7 reportes llega como
  // "histórico rezagado" (+8–20 min) para ejercitar el cursor por dataCtrTime.
  const esRezagado = aleatorio01(`${m.esn}|lag|${tMs}`) < 1 / 7
  const latenciaMs = esRezagado
    ? (8 + aleatorio01(`${m.esn}|lag2|${tMs}`) * 12) * 60_000
    : (20 + aleatorio01(`${m.esn}|lag3|${tMs}`) * 80) * 1000

  return {
    medio: m,
    posTimeMs: tMs,
    dataCtrTimeMs: tMs + Math.round(latenciaMs),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    alt,
    spd,
    cog,
    navstate,
  }
}

// ── Serialización al formato GeoJSON real ────────────────────────────────────

/** ISO con microsegundos simulados, como el servidor real. */
function isoMicro(ms: number, semilla: string): string {
  const base = new Date(ms).toISOString() // ...sss'Z'
  const micro = String(Math.floor(aleatorio01(semilla) * 1000)).padStart(3, '0')
  return base.replace('Z', `${micro}Z`)
}

function feature(p: PosicionSimulada, completo: boolean): Record<string, unknown> {
  const propiedades: Record<string, unknown> = {
    esn: p.medio.esn,
    posTime: new Date(p.posTimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    cog: p.cog,
    dataCtrTime: isoMicro(p.dataCtrTimeMs, `${p.medio.esn}|micro|${p.posTimeMs}`),
    src: 'GPS',
    spd: Math.round(p.spd * 1.943844), // spd en NUDOS (hipótesis del contrato real)
    fix: p.medio.fix,
    pdop: 1 + Math.round(aleatorio01(`${p.medio.esn}|pdop|${p.posTimeMs}`) * 3),
    hdop: 1 + Math.round(aleatorio01(`${p.medio.esn}|hdop|${p.posTimeMs}`) * 2),
    // /get real también trae unitId y atu (observado 7-jul-2026); los hg*
    // completos siguen siendo exclusivos de get_lastpositions
    unitId: p.medio.hgAsset,
    atu: { events: { aircraft: { power: p.navstate === 2 ? 'off' : 'on' } } },
    hgExtName: p.medio.hgExtName, // único hg* presente también en /get
  }
  if (p.alt !== null) propiedades.alt = p.alt

  if (completo) {
    // metadatos SOLO de get_lastpositions, como el servidor real
    Object.assign(propiedades, {
      hgAlias: p.medio.hgAlias,
      hgAssetModel: p.medio.hgAssetModel,
      hgCompany: 'SIMULADO',
      hgNavstate: String(p.navstate), // string, como el real
      hgAsset: p.medio.hgAsset,
      hgSource: p.medio.hgSource,
      hgAssetFamily: p.medio.hgAssetFamily,
      hgFamilyType: p.medio.hgFamilyType,
    })
  }

  return {
    type: 'Feature',
    properties: propiedades,
    geometry: {
      type: 'Point',
      coordinates: [p.lon, p.lat], // GeoJSON: [longitud, latitud]
    },
  }
}

function featureCollection(features: Record<string, unknown>[]): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    dataInfo: [{ affVer: 'json 1.0', provider: 'Nexe (SIMULADO)', rptTime: new Date().toISOString() }],
    features,
  }
}

// ── Consultas ────────────────────────────────────────────────────────────────

/** Posiciones con dataCtrTime estrictamente > desde, hasta ahora. Límite 1000. */
function posicionesLlegadasDesde(desdeMs: number, ahoraMs: number): PosicionSimulada[] {
  // Un reporte con posTime viejo puede llegar tarde (hasta +20 min), así que
  // barremos posTime desde antes de la ventana pedida.
  const margenMs = 25 * 60_000
  const maximoVentanaMs = 12 * 3600_000
  const inicio = Math.max(desdeMs - margenMs, ahoraMs - maximoVentanaMs)

  const resultado: PosicionSimulada[] = []
  for (const medio of FLOTA) {
    const primerPaso = Math.ceil(inicio / PASO_REPORTE_MS) * PASO_REPORTE_MS
    for (let t = primerPaso; t <= ahoraMs; t += PASO_REPORTE_MS) {
      const pos = posicionEnInstante(medio, t)
      if (!pos) continue
      if (pos.dataCtrTimeMs > desdeMs && pos.dataCtrTimeMs <= ahoraMs) resultado.push(pos)
    }
  }
  // el servidor real trunca a ~1000 ordenando por llegada
  resultado.sort((a, b) => a.dataCtrTimeMs - b.dataCtrTimeMs)
  return resultado.slice(0, LIMITE_RESPUESTA)
}

function ultimasPosiciones(ahoraMs: number, domains: string[] | null): PosicionSimulada[] {
  const resultado: PosicionSimulada[] = []
  for (const medio of FLOTA) {
    if (domains !== null && !domains.includes(medio.hgFamilyType)) continue
    const inicio = Math.floor(ahoraMs / PASO_REPORTE_MS) * PASO_REPORTE_MS
    for (let t = inicio; t > ahoraMs - 24 * 3600_000; t -= PASO_REPORTE_MS) {
      const pos = posicionEnInstante(medio, t)
      if (pos) {
        resultado.push(pos)
        break
      }
    }
  }
  return resultado
}

// ── Extracción tolerante de parámetros del msgRequest ────────────────────────

function extraerCampo(msgRequest: unknown[], claves: string[]): string | null {
  for (const item of msgRequest) {
    if (typeof item === 'object' && item !== null) {
      for (const clave of claves) {
        const valor = (item as Record<string, unknown>)[clave]
        if (typeof valor === 'string' && valor !== 'string' && valor !== '') return valor
      }
    }
  }
  return null
}

/** `domain` viene como lista de familias (contrato real). */
function extraerDomain(msgRequest: unknown[]): string[] | null {
  for (const item of msgRequest) {
    if (typeof item === 'object' && item !== null) {
      const valor = (item as Record<string, unknown>).domain
      if (Array.isArray(valor)) {
        const dominios = valor.filter((d): d is string => typeof d === 'string')
        if (dominios.length > 0) return dominios.map((d) => d.toLowerCase())
      }
    }
  }
  return null
}

// ── Rutas (mismas del servidor real) ─────────────────────────────────────────

function manejar(modo: 'get' | 'last'): express.RequestHandler {
  return (req, res) => {
    const responder = () => {
      // auth: header exacto `api-key`, cualquier valor no vacío
      const key = req.header('api-key')
      if (!key) {
        res.status(401).json({ detail: 'Incorrect api key or JWT Token' })
        return
      }

      const validacion = validarBodyNexe(req.body)
      if (!validacion.ok) {
        if (validacion.status === 422) {
          res.status(422).json({ detail: validacion.detail })
        } else {
          res.status(500).type('text/plain').send('Internal Server Error')
        }
        return
      }

      if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
        res.status(500).type('text/plain').send('Internal Server Error')
        return
      }

      const ahora = Date.now()
      if (modo === 'last') {
        // el `domain` real es una lista (422 confirmado); a diferencia del
        // servidor real (que hoy devuelve 500 — bug escalado), el mock
        // implementa el filtro según la intención documentada
        const domains = extraerDomain(validacion.msgRequest)
        const posiciones = ultimasPosiciones(ahora, domains)
        res.json(featureCollection(posiciones.map((p) => feature(p, true))))
        return
      }

      const desdeTexto = extraerCampo(validacion.msgRequest, ['dataCtrTime'])
      const desdeMs = desdeTexto !== null ? Date.parse(desdeTexto) : NaN
      const desde = Number.isNaN(desdeMs) ? ahora - 2 * 3600_000 : desdeMs
      const posiciones = posicionesLlegadasDesde(desde, ahora)
      res.json(featureCollection(posiciones.map((p) => feature(p, false))))
    }
    if (LATENCY_MS > 0) setTimeout(responder, LATENCY_MS)
    else responder()
  }
}

app.post('/api/v1/monitor/position/affjson/get', manejar('get'))
app.post('/api/v1/monitor/position/affjson/get_lastpositions', manejar('last'))

// método incorrecto → 405, como el servidor real
app.all('/api/v1/monitor/position/affjson/:resto', (_req, res) => {
  res.status(405).json({ detail: 'Method Not Allowed' })
})

app.listen(PORT, () => {
  console.log(
    `[mock] Nexe simulado en http://localhost:${PORT}/api/v1/monitor (flota: ${FLOTA.length} medios)`,
  )
})
