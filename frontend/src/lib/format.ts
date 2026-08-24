/**
 * Presentación: todo el intercambio es UTC; la UI muestra hora de Chile
 * (America/Santiago) con tooltip del valor UTC crudo (CLAUDE.md §10.3).
 */

const ZONA_CHILE = 'America/Santiago'

const formatoHoraChile = new Intl.DateTimeFormat('es-CL', {
  timeZone: ZONA_CHILE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const formatoFechaHoraChile = new Intl.DateTimeFormat('es-CL', {
  timeZone: ZONA_CHILE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** "14:03:22" en hora de Chile. */
export function horaChile(isoUtc: string): string {
  const ms = Date.parse(isoUtc)
  if (Number.isNaN(ms)) return '—'
  return formatoHoraChile.format(ms)
}

/** "02-07 14:03:22" en hora de Chile. */
export function fechaHoraChile(isoUtc: string): string {
  const ms = Date.parse(isoUtc)
  if (Number.isNaN(ms)) return '—'
  return formatoFechaHoraChile.format(ms)
}

/** Valor UTC crudo para tooltips. */
export function utcCrudo(isoUtc: string): string {
  return `${isoUtc} (UTC)`
}

/** "hace 40 s", "hace 3 min", "hace 2 h 05 min", "hace 10 d 5 h". */
export function haceCuanto(segundos: number): string {
  if (segundos < 0) return 'hace 0 s'
  if (segundos < 90) return `hace ${Math.round(segundos)} s`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h ${String(minutos % 60).padStart(2, '0')} min`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} d ${horas % 24} h`
}

/**
 * `spd` → "173 km/h (93 kn)". Unidades siempre visibles (§10.3).
 *
 * spd viene en METROS POR SEGUNDO — CONFIRMADO empíricamente (30-jul-2026)
 * comparando 1.287 pares de posiciones consecutivas reales contra la distancia
 * haversine recorrida: la mediana del ratio (m/s real / spd) dio 0,90 y los
 * tramos de 30 s ~1,00. Nudos habría dado 0,51 y km/h 0,28.
 */
export const MS_A_KMH = 3.6
const MS_A_NUDOS = 1.943844

export function velocidad(metrosPorSegundo?: number): string {
  if (metrosPorSegundo === undefined) return '—'
  const kmh = Math.round(metrosPorSegundo * MS_A_KMH)
  const nudos = Math.round(metrosPorSegundo * MS_A_NUDOS)
  return `${kmh} km/h (${nudos} kn)`
}

/** "832 m". */
export function altitud(m?: number): string {
  return m === undefined ? '—' : `${Math.round(m)} m`
}

/** "247°". */
export function rumbo(grados?: number): string {
  return grados === undefined ? '—' : `${Math.round(grados)}°`
}

/** "−35.43021, −71.65112" (5 decimales ≈ 1 m). */
export function coordenadas(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}
