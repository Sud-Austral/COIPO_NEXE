/**
 * Simulador de Nexe COMPARTIDO (CLAUDE.md §9): lo consume el mock Express
 * (server/mock.ts) y también el navegador en el despliegue estático de
 * GitHub Pages (VITE_DEMO=1), donde no existe proxy — Nexe no implementa
 * CORS y la key jamás viaja al bundle (§3/§14.1).
 *
 * Módulo PURO: sin Express, sin dotenv, sin acceso a red. Replica el
 * contrato real confirmado: GeoJSON FeatureCollection, coordenadas
 * [lon, lat], límite 1000, filtro estrictamente `>` por dataCtrTime,
 * hg* completos solo en lastpositions, hgNavstate como string.
 */

export const PASO_REPORTE_MS = 120_000 // una posición cada ~2 min (estándar AFF)
export const LIMITE_RESPUESTA = 1000 // límite real del servidor Nexe

// ── Flota ficticia ────────────────────────────────────────────────────────────

export interface MedioSimulado {
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
  /** m/s cuando se mueve (interno; el `spd` serializado va en nudos) */
  velocidadCrucero: number
  guion: 'volando' | 'ciclo-vuelo-tierra' | 'emitiendo-tierra' | 'detenida-sin-senal' | 'parado'
}

export const FLOTA: MedioSimulado[] = [
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
    // staging real incluye medios terrestres — el simulador también (CLAUDE.md §9)
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

export interface PosicionSimulada {
  medio: MedioSimulado
  posTimeMs: number
  dataCtrTimeMs: number
  lat: number
  lon: number
  alt: number | null
  spd: number // m/s interno
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

export function feature(p: PosicionSimulada, completo: boolean): Record<string, unknown> {
  const propiedades: Record<string, unknown> = {
    esn: p.medio.esn,
    posTime: new Date(p.posTimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    cog: p.cog,
    dataCtrTime: isoMicro(p.dataCtrTimeMs, `${p.medio.esn}|micro|${p.posTimeMs}`),
    src: 'GPS',
    spd: Math.round(p.spd), // m/s — unidad CONFIRMADA con datos reales (§2)
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

export function featureCollection(features: Record<string, unknown>[]): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    dataInfo: [
      { affVer: 'json 1.0', provider: 'Nexe (SIMULADO)', rptTime: new Date().toISOString() },
    ],
    features,
  }
}

// ── Consultas ────────────────────────────────────────────────────────────────

/** Posiciones con dataCtrTime estrictamente > desde, hasta ahora. Límite 1000. */
export function posicionesLlegadasDesde(desdeMs: number, ahoraMs: number): PosicionSimulada[] {
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

export function ultimasPosiciones(ahoraMs: number, domains: string[] | null): PosicionSimulada[] {
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

// ── Punto de entrada del modo demo en el navegador ───────────────────────────

/** ISO con microsegundos, como los cursores reales del backend. */
function isoCursor(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '000Z')
}

/**
 * Atiende una consulta del cliente con la MISMA semántica del backend real
 * (mismas rutas, mismos query params, misma forma de respuesta). En VITE_DEMO=1
 * reemplaza al fetch: cero red, cero backend, cero secretos.
 */
export function manejarSimulacion(
  ruta: 'posiciones/incremental' | 'posiciones' | 'recursos' | 'estado-ingesta',
  parametros: Record<string, string | number | undefined>,
): unknown {
  const ahora = Date.now()
  const texto = (clave: string): string | undefined => {
    const valor = parametros[clave]
    return valor === undefined ? undefined : String(valor)
  }

  if (ruta === 'recursos') {
    const familia = texto('familia')
    const posiciones = ultimasPosiciones(ahora, familia ? [familia] : null)
    return {
      ...featureCollection(posiciones.map((p) => feature(p, true))),
      recursos: posiciones.length,
    }
  }

  if (ruta === 'estado-ingesta') {
    return {
      cursor: isoCursor(ahora),
      ultimaCorridaOkEn: isoCursor(ahora - 30_000),
      minutosDesdeUltimaCorridaOk: 0.5,
      ingestaDetenida: false,
      posicionesUltimaCorrida: FLOTA.length,
      fallosConsecutivos: 0,
      ultimoErrorEn: null,
      ultimoErrorClase: null,
    }
  }

  if (ruta === 'posiciones') {
    const desde = Date.parse(texto('desde') ?? '')
    const hasta = Date.parse(texto('hasta') ?? '')
    const inicio = Number.isNaN(desde) ? ahora - 6 * 3600_000 : desde
    const fin = Number.isNaN(hasta) ? ahora : hasta
    const limite = Number(parametros.limite ?? 20000)
    // El histórico filtra por posTime (cuándo estuvo ahí), no por llegada.
    const enRango = posicionesLlegadasDesde(inicio - 3600_000, fin).filter(
      (p) => p.posTimeMs >= inicio && p.posTimeMs <= fin,
    )
    const recortadas = enRango.slice(0, limite)
    return {
      ...featureCollection(recortadas.map((p) => feature(p, false))),
      desde: new Date(inicio).toISOString(),
      hasta: new Date(fin).toISOString(),
      truncado: recortadas.length >= limite,
    }
  }

  // posiciones/incremental
  const cursorMs = Date.parse(texto('cursor') ?? '')
  const desde = Number.isNaN(cursorMs) ? ahora - 2 * 3600_000 : cursorMs
  const limite = Number(parametros.limite ?? 1000)
  const encontradas = posicionesLlegadasDesde(desde, ahora)
  const recortadas = encontradas.slice(0, limite)
  const ultima = recortadas[recortadas.length - 1]
  return {
    ...featureCollection(recortadas.map((p) => feature(p, false))),
    siguienteCursor: ultima ? isoCursor(ultima.dataCtrTimeMs) : isoCursor(desde),
    hayMas: recortadas.length >= limite,
  }
}
