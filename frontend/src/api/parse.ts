/**
 * Parser de la respuesta de Nexe (CLAUDE.md §8.2).
 *
 * Camino principal CONGELADO al contrato real (correo 3-jul-2026): GeoJSON
 * FeatureCollection — cada feature se aplana a {...properties, latitude,
 * longitude} tomando geometry.coordinates en orden [lon, lat].
 *
 * Se mantienen fallbacks tolerantes (lista directa / objeto contenedor) y la
 * detección de errores disfrazados ({detail: ...}).
 */
import type { NavState, NexePosition } from '../domain/types'

/** Un objeto {detail: ...} no es data: es un error FastAPI disfrazado. */
export class NexeRespuestaError extends Error {
  constructor(
    public tipo: 'error_disfrazado' | 'formato_desconocido',
    public detalle: unknown,
  ) {
    super(
      tipo === 'error_disfrazado'
        ? 'La respuesta de Nexe es un error ({detail}), no una lista de posiciones'
        : 'No se encontró una lista de posiciones en la respuesta de Nexe',
    )
    this.name = 'NexeRespuestaError'
  }
}

const CLAVES_CANDIDATAS = ['positions', 'data', 'items', 'results', 'reports', 'affjson']

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function esListaDeObjetos(valor: unknown): valor is Record<string, unknown>[] {
  return Array.isArray(valor) && valor.length > 0 && valor.every(esObjeto)
}

/**
 * Aplana una feature GeoJSON a un registro plano. Si el ítem no es una
 * feature (sin properties/geometry), se devuelve tal cual.
 */
function aplanarFeature(item: Record<string, unknown>): Record<string, unknown> {
  const propiedades = esObjeto(item.properties) ? item.properties : null
  if (!propiedades) return item

  const plano: Record<string, unknown> = { ...propiedades }
  if (esObjeto(item.geometry) && Array.isArray(item.geometry.coordinates)) {
    const coordenadas = item.geometry.coordinates as unknown[]
    // GeoJSON: [longitud, latitud, (altitud opcional)]
    if (coordenadas.length >= 2) {
      plano.longitude = coordenadas[0]
      plano.latitude = coordenadas[1]
      if (coordenadas.length >= 3 && plano.altitude === undefined) {
        plano.altitude = coordenadas[2]
      }
    }
  }
  return plano
}

/** Extrae la lista cruda de registros planos según §8.2. */
export function extraerLista(cruda: unknown): Record<string, unknown>[] {
  // 1) contrato real: FeatureCollection con `features`
  if (esObjeto(cruda) && Array.isArray(cruda.features)) {
    return (cruda.features as unknown[]).filter(esObjeto).map(aplanarFeature)
  }

  // 2) fallbacks tolerantes
  if (Array.isArray(cruda)) {
    return cruda.filter(esObjeto).map(aplanarFeature)
  }
  if (esObjeto(cruda)) {
    const claves = Object.keys(cruda)
    if ('detail' in cruda && claves.length === 1) {
      throw new NexeRespuestaError('error_disfrazado', cruda.detail)
    }
    // claves candidatas primero (aceptan lista vacía: "sin posiciones" es válido)
    const clavesMinusculas = new Map(claves.map((c) => [c.toLowerCase(), c]))
    for (const candidata of CLAVES_CANDIDATAS) {
      const real = clavesMinusculas.get(candidata)
      if (real !== undefined && Array.isArray(cruda[real])) {
        return (cruda[real] as unknown[]).filter(esObjeto).map(aplanarFeature)
      }
    }
    // si no, la primera propiedad que sea lista de objetos
    for (const valor of Object.values(cruda)) {
      if (esListaDeObjetos(valor)) return valor.map(aplanarFeature)
    }
  }
  throw new NexeRespuestaError('formato_desconocido', cruda)
}

// ── Normalización de nombres (nombres reales + alias tolerantes) ─────────────

const ALIAS: Record<string, string[]> = {
  esn: ['esn', 'serialnumber', 'serial'],
  posTime: ['postime', 'datetime', 'date_time', 'positiontime', 'gpstime'],
  dataCtrTime: ['datactrtime', 'data_ctr_time', 'datacentertime', 'servertime'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lon', 'lng', 'long'],
  altitude: ['altitude', 'alt'], // aún no observado en el real (§2 PENDIENTE)
  speed: ['spd', 'speed', 'velocity'], // nombre real: spd
  heading: ['cog', 'heading', 'course', 'track'], // nombre real: cog
  fixType: ['fix', 'fixtype', 'fix_type'], // nombre real: fix
  src: ['src'],
  pdop: ['pdop'],
  hdop: ['hdop'],
  unitId: ['unitid', 'unit_id'],
  hgExtName: ['hgextname'],
  hgAlias: ['hgalias'],
  hgAsset: ['hgasset'],
  hgAssetModel: ['hgassetmodel'],
  hgAssetFamily: ['hgassetfamily'],
  hgFamilyType: ['hgfamilytype'],
  hgCompany: ['hgcompany'],
  hgSource: ['hgsource'],
  hgNavstate: ['hgnavstate', 'navstate'],
}

function comoNumero(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function comoTexto(valor: unknown): string | undefined {
  if (typeof valor === 'string' && valor !== '') return valor
  if (typeof valor === 'number') return String(valor)
  return undefined
}

function comoIsoUtc(valor: unknown): string | undefined {
  const texto = comoTexto(valor)
  if (texto === undefined) return undefined
  const ms = Date.parse(texto)
  if (Number.isNaN(ms)) return undefined
  return texto // conservar el valor original (trae microsegundos en el real)
}

function comoFixType(valor: unknown): NexePosition['fixType'] {
  const texto = comoTexto(valor)?.toLowerCase()
  if (texto === '3d') return '3D'
  if (texto === '2d') return '2D'
  if (texto === 'invalid') return 'Invalid'
  return undefined
}

/** hgNavstate llega como string ("2") en el JSON real — coercionar. */
function comoNavState(valor: unknown): NavState | undefined {
  const n = comoNumero(valor)
  return n === 2 || n === 4 || n === 5 ? n : undefined
}

/**
 * Normaliza un registro plano a NexePosition. Devuelve null si faltan los
 * esenciales (esn, posTime, lat/lon numéricos) — se cuenta como descartado.
 */
export function normalizarPosicion(crudo: Record<string, unknown>): NexePosition | null {
  const porClave = new Map<string, unknown>()
  for (const [clave, valor] of Object.entries(crudo)) {
    porClave.set(clave.toLowerCase(), valor)
  }
  const buscar = (campo: string): unknown => {
    for (const alias of ALIAS[campo] ?? []) {
      if (porClave.has(alias)) return porClave.get(alias)
    }
    return undefined
  }

  const esn = comoTexto(buscar('esn'))
  const posTime = comoIsoUtc(buscar('posTime'))
  const latitude = comoNumero(buscar('latitude'))
  const longitude = comoNumero(buscar('longitude'))
  if (esn === undefined || posTime === undefined || latitude === undefined || longitude === undefined) {
    return null
  }

  return {
    esn,
    posTime,
    // si el servidor no manda dataCtrTime, usar posTime evita retroceder el cursor
    dataCtrTime: comoIsoUtc(buscar('dataCtrTime')) ?? posTime,
    latitude,
    longitude,
    altitude: comoNumero(buscar('altitude')),
    speed: comoNumero(buscar('speed')),
    heading: comoNumero(buscar('heading')),
    fixType: comoFixType(buscar('fixType')),
    src: comoTexto(buscar('src')),
    pdop: comoNumero(buscar('pdop')),
    hdop: comoNumero(buscar('hdop')),
    unitId: comoTexto(buscar('unitId')),
    hgExtName: comoTexto(buscar('hgExtName')),
    hgAlias: comoTexto(buscar('hgAlias')),
    hgAsset: comoTexto(buscar('hgAsset')),
    hgAssetModel: comoTexto(buscar('hgAssetModel')),
    hgAssetFamily: comoTexto(buscar('hgAssetFamily')),
    hgFamilyType: comoTexto(buscar('hgFamilyType')),
    hgCompany: comoTexto(buscar('hgCompany')),
    hgSource: comoTexto(buscar('hgSource')),
    hgNavstate: comoNavState(buscar('hgNavstate')),
  }
}

export interface ResultadoParse {
  posiciones: NexePosition[]
  descartadas: number
}

/** Punto de entrada: respuesta cruda de Nexe → posiciones normalizadas. */
export function parsePositions(cruda: unknown): ResultadoParse {
  const lista = extraerLista(cruda)
  const posiciones: NexePosition[] = []
  let descartadas = 0
  for (const registro of lista) {
    const posicion = normalizarPosicion(registro)
    if (posicion) posiciones.push(posicion)
    else descartadas += 1
  }
  return { posiciones, descartadas }
}
