/**
 * Agregación de la flota por ESN: dedupe, orden, tope de buffer y frescura
 * (CLAUDE.md §8.3 y §8.4).
 */
import type { FleetResource, Freshness, NexePosition } from './types'

export const MAX_TRAIL_PUNTOS = 1000
export const MAX_TRAIL_MS = 6 * 3600_000 // 6 horas

export const UMBRAL_LIVE_S = 120 // < 2 min → live
export const UMBRAL_DELAYED_S = 300 // 2–5 min → delayed; > 5 min → stale

/** Buffer por ESN: posiciones ordenadas por posTime asc, sin duplicados. */
export type FleetStore = Map<string, NexePosition[]>

function claveDedupe(p: NexePosition): string {
  return `${p.esn}|${p.posTime}`
}

/**
 * Fusiona posiciones nuevas en el store. Dedupe por (esn, posTime) — el
 * solapamiento de rangos produce duplicados esperables. Devuelve un Map nuevo
 * (inmutable hacia React) y cuántas posiciones realmente se agregaron.
 */
export function mergePositions(
  store: FleetStore,
  nuevas: NexePosition[],
): { store: FleetStore; agregadas: number } {
  if (nuevas.length === 0) return { store, agregadas: 0 }

  const resultado: FleetStore = new Map(store)
  let agregadas = 0
  const tocados = new Set<string>()

  for (const posicion of nuevas) {
    const trail = resultado.get(posicion.esn)
    if (!trail) {
      resultado.set(posicion.esn, [posicion])
      tocados.add(posicion.esn)
      agregadas += 1
      continue
    }
    if (!tocados.has(posicion.esn)) {
      // copiar una sola vez por ESN tocado
      resultado.set(posicion.esn, [...trail])
      tocados.add(posicion.esn)
    }
    const copia = resultado.get(posicion.esn)!
    const clave = claveDedupe(posicion)
    if (copia.some((p) => claveDedupe(p) === clave)) continue
    copia.push(posicion)
    agregadas += 1
  }

  // ordenar por posTime asc (los históricos llegan desordenados) y aplicar tope
  for (const esn of tocados) {
    const trail = resultado.get(esn)!
    trail.sort((a, b) => Date.parse(a.posTime) - Date.parse(b.posTime))
    resultado.set(esn, aplicarTope(trail))
  }

  return { store: resultado, agregadas }
}

/** Tope de memoria: últimas 6 h (respecto del punto más nuevo) o 1000 puntos. */
function aplicarTope(trailOrdenada: NexePosition[]): NexePosition[] {
  let recortada = trailOrdenada
  if (recortada.length > MAX_TRAIL_PUNTOS) {
    recortada = recortada.slice(recortada.length - MAX_TRAIL_PUNTOS)
  }
  const masNuevo = Date.parse(recortada[recortada.length - 1]!.posTime)
  const limite = masNuevo - MAX_TRAIL_MS
  const primerVigente = recortada.findIndex((p) => Date.parse(p.posTime) >= limite)
  return primerVigente > 0 ? recortada.slice(primerVigente) : recortada
}

export function computeFreshness(staleSeconds: number): Freshness {
  if (staleSeconds < UMBRAL_LIVE_S) return 'live'
  if (staleSeconds <= UMBRAL_DELAYED_S) return 'delayed'
  return 'stale'
}

/**
 * Los metadatos hg* vienen SOLO en get_lastpositions (las trazas de /get solo
 * traen hgExtName): el recurso hereda el último valor conocido de cada campo.
 */
type CampoMeta =
  | 'unitId'
  | 'hgExtName'
  | 'hgAlias'
  | 'hgAsset'
  | 'hgAssetModel'
  | 'hgAssetFamily'
  | 'hgFamilyType'
  | 'hgCompany'
  | 'hgSource'
  | 'hgNavstate'

const CAMPOS_META: CampoMeta[] = [
  'unitId',
  'hgExtName',
  'hgAlias',
  'hgAsset',
  'hgAssetModel',
  'hgAssetFamily',
  'hgFamilyType',
  'hgCompany',
  'hgSource',
  'hgNavstate',
]

function fusionarMetadatos(trail: NexePosition[], base: NexePosition): NexePosition {
  const resultado: NexePosition = { ...base }
  let faltan = CAMPOS_META.filter((campo) => resultado[campo] === undefined)
  for (let i = trail.length - 1; i >= 0 && faltan.length > 0; i--) {
    const posicion = trail[i]!
    for (const campo of faltan) {
      if (posicion[campo] !== undefined) {
        ;(resultado as Record<CampoMeta, unknown>)[campo] = posicion[campo]
      }
    }
    faltan = faltan.filter((campo) => resultado[campo] === undefined)
  }
  return resultado
}

/** Recurso agregado a partir del buffer de un ESN. */
function construirRecurso(esn: string, trail: NexePosition[], ahoraMs: number): FleetResource {
  const validas = trail.filter((p) => p.fixType !== 'Invalid')
  const invalidas = trail.length - validas.length

  // marcador y telemetría: última posición con fix utilizable; si todas son
  // inválidas, la última a secas (peor es no mostrar nada)
  const base = (validas.length > 0 ? validas : trail)[
    (validas.length > 0 ? validas : trail).length - 1
  ]!
  const ultima = fusionarMetadatos(trail, base)

  // la frescura mide la SEÑAL: cuenta el último reporte, válido o no
  const ultimoReporteMs = Date.parse(trail[trail.length - 1]!.posTime)
  const staleSeconds = Math.max(0, Math.round((ahoraMs - ultimoReporteMs) / 1000))

  return {
    esn,
    label: ultima.hgExtName ?? ultima.hgAsset ?? esn,
    last: ultima,
    trail: validas,
    navState: ultima.hgNavstate ?? null,
    staleSeconds,
    freshness: computeFreshness(staleSeconds),
    posicionesInvalidas: invalidas,
  }
}

/** Store → lista de recursos, ordenada por frescura y luego por label. */
export function buildFleet(store: FleetStore, ahoraMs: number): FleetResource[] {
  const orden: Record<Freshness, number> = { live: 0, delayed: 1, stale: 2 }
  const recursos: FleetResource[] = []
  for (const [esn, trail] of store) {
    if (trail.length === 0) continue
    recursos.push(construirRecurso(esn, trail, ahoraMs))
  }
  recursos.sort(
    (a, b) => orden[a.freshness] - orden[b.freshness] || a.label.localeCompare(b.label, 'es'),
  )
  return recursos
}

/** Máximo dataCtrTime de una tanda — el candidato a nuevo cursor (§8.3). */
export function maxDataCtrTime(posiciones: NexePosition[]): string | null {
  let maximo: string | null = null
  let maximoMs = -Infinity
  for (const p of posiciones) {
    const ms = Date.parse(p.dataCtrTime)
    if (!Number.isNaN(ms) && ms > maximoMs) {
      maximoMs = ms
      maximo = p.dataCtrTime
    }
  }
  return maximo
}
