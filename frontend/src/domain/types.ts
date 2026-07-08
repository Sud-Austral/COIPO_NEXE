/** Tipos del dominio (CLAUDE.md §8.4). Intercambio siempre en UTC. */

/** En el JSON real llega como string ("2") — el parser lo coerciona a número. */
export type NavState = 2 | 4 | 5

/** Familia canónica del activo (filtro `domain` de get_lastpositions). */
export type FamilyType = 'people' | 'ground' | 'rotary' | 'fixed'

export interface NexePosition {
  esn: string
  posTime: string // ISO UTC
  dataCtrTime: string // ISO UTC (con microsegundos en el real)
  latitude: number // geometry.coordinates[1]
  longitude: number // geometry.coordinates[0]
  altitude?: number // m MSL — aún no observado en el real (§2 PENDIENTE)
  speed?: number // `spd` — hipótesis NUDOS (m/s descartado con datos reales; §2 PENDIENTE)
  heading?: number // `cog`, grados 0–359
  fixType?: '3D' | '2D' | 'Invalid' // `fix`: configuración de la baliza, no calidad puntual
  src?: string // fuente de la posición ("GPS")
  pdop?: number
  hdop?: number // no observado aún
  unitId?: string // solo lastpositions
  hgExtName?: string // único hg* presente también en /get
  hgAlias?: string // los siguientes: solo lastpositions
  hgAsset?: string
  hgAssetModel?: string
  hgAssetFamily?: string
  hgFamilyType?: FamilyType | string
  hgCompany?: string
  hgSource?: string
  hgNavstate?: NavState
}

export type Freshness = 'live' | 'delayed' | 'stale'

export interface FleetResource {
  esn: string
  label: string // hgExtName ?? hgAsset ?? esn
  last: NexePosition // última posición con fix utilizable (o la última a secas)
  trail: NexePosition[] // solo fixes válidos, ordenada por posTime asc, con tope (§8.3)
  navState: NavState | null
  staleSeconds: number // ahora − max(posTime del recurso)
  freshness: Freshness // <2 min / 2–5 min / >5 min
  posicionesInvalidas: number // fixes "Invalid" en el buffer (badge de calidad)
}
