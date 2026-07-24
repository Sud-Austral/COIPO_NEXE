import { describe, expect, it } from 'vitest'
import {
  buildFleet,
  computeFreshness,
  maxDataCtrTime,
  mergePositions,
  MAX_TRAIL_PUNTOS,
  type FleetStore,
} from '../src/domain/fleet'
import type { NexePosition } from '../src/domain/types'

const BASE_MS = Date.parse('2026-07-03T10:00:00.000Z')

function posicion(esn: string, offsetSeg: number, extra: Partial<NexePosition> = {}): NexePosition {
  const t = new Date(BASE_MS + offsetSeg * 1000).toISOString()
  return {
    esn,
    posTime: t,
    dataCtrTime: new Date(BASE_MS + (offsetSeg + 30) * 1000).toISOString(),
    latitude: -35.5,
    longitude: -71.5,
    ...extra,
  }
}

describe('mergePositions — dedupe y orden (§8.3)', () => {
  it('dedupe por (esn, posTime): el solapamiento de rangos no duplica', () => {
    const p = posicion('A', 0)
    let store: FleetStore = new Map()
    store = mergePositions(store, [p]).store
    const resultado = mergePositions(store, [p, posicion('A', 60)])
    expect(resultado.agregadas).toBe(1)
    expect(resultado.store.get('A')).toHaveLength(2)
  })

  it('misma posTime en ESN distinto NO es duplicado', () => {
    const { store } = mergePositions(new Map(), [posicion('A', 0), posicion('B', 0)])
    expect(store.get('A')).toHaveLength(1)
    expect(store.get('B')).toHaveLength(1)
  })

  it('ordena la traza por posTime ascendente aunque llegue desordenada', () => {
    const { store } = mergePositions(new Map(), [
      posicion('A', 120),
      posicion('A', 0),
      posicion('A', 240),
      posicion('A', 60),
    ])
    const tiempos = store.get('A')!.map((p) => p.posTime)
    expect(tiempos).toEqual([...tiempos].sort())
  })

  it('tope de buffer: nunca más de 1000 puntos por ESN', () => {
    const muchas = Array.from({ length: MAX_TRAIL_PUNTOS + 50 }, (_, i) => posicion('A', i * 10))
    const { store } = mergePositions(new Map(), muchas)
    expect(store.get('A')!.length).toBe(MAX_TRAIL_PUNTOS)
    // se conservan las MÁS NUEVAS
    expect(store.get('A')![0]!.posTime).toBe(muchas[50]!.posTime)
  })

  it('tope de buffer: descarta lo más antiguo que 6 h respecto del punto más nuevo', () => {
    const vieja = posicion('A', 0)
    const nueva = posicion('A', 7 * 3600) // 7 h después
    const { store } = mergePositions(new Map(), [vieja, nueva])
    expect(store.get('A')).toHaveLength(1)
    expect(store.get('A')![0]!.posTime).toBe(nueva.posTime)
  })

  it('modo histórico (limitarVentana: false): conserva rangos más largos que 6 h', () => {
    const vieja = posicion('A', 0)
    const nueva = posicion('A', 7 * 3600)
    const { store } = mergePositions(new Map(), [vieja, nueva], { limitarVentana: false })
    expect(store.get('A')).toHaveLength(2)
  })
})

describe('computeFreshness — umbrales (§8.4)', () => {
  it('< 2 min → live', () => {
    expect(computeFreshness(0)).toBe('live')
    expect(computeFreshness(119)).toBe('live')
  })
  it('2–5 min → delayed', () => {
    expect(computeFreshness(120)).toBe('delayed')
    expect(computeFreshness(300)).toBe('delayed')
  })
  it('> 5 min → stale', () => {
    expect(computeFreshness(301)).toBe('stale')
    expect(computeFreshness(9999)).toBe('stale')
  })
})

describe('buildFleet — agregación por recurso', () => {
  it('fusiona los metadatos hg* (solo vienen en lastpositions) sobre la traza de /get', () => {
    // traza de /get: sin metadatos, solo hgExtName
    const traza = [
      posicion('A', 0, { hgExtName: 'HT-01' }),
      posicion('A', 60, { hgExtName: 'HT-01' }),
    ]
    // lastpositions: más antigua pero con metadatos completos
    const conMeta = posicion('A', -300, {
      hgExtName: 'HT-01',
      hgAsset: 'CC-AQY',
      hgAssetModel: 'Bell 412EP',
      hgNavstate: 5,
      hgCompany: 'CONAF',
    })
    const { store } = mergePositions(new Map(), [...traza, conMeta])
    const flota = buildFleet(store, BASE_MS + 90_000)
    const recurso = flota[0]!
    // telemetría de la posición más reciente…
    expect(recurso.last.posTime).toBe(traza[1]!.posTime)
    // …enriquecida con los últimos metadatos conocidos
    expect(recurso.last.hgAsset).toBe('CC-AQY')
    expect(recurso.last.hgAssetModel).toBe('Bell 412EP')
    expect(recurso.navState).toBe(5)
    expect(recurso.label).toBe('HT-01')
  })

  it('label cae a hgAsset y luego a esn si no hay alias', () => {
    const soloAsset = mergePositions(new Map(), [posicion('B', 0, { hgAsset: 'CC-XXX' })]).store
    expect(buildFleet(soloAsset, BASE_MS)[0]!.label).toBe('CC-XXX')
    const soloEsn = mergePositions(new Map(), [posicion('C', 0)]).store
    expect(buildFleet(soloEsn, BASE_MS)[0]!.label).toBe('C')
  })

  it('cuenta fixes Invalid y los excluye de la trail del mapa', () => {
    const { store } = mergePositions(new Map(), [
      posicion('A', 0, { fixType: '3D' }),
      posicion('A', 60, { fixType: 'Invalid' }),
      posicion('A', 120, { fixType: '3D' }),
    ])
    const recurso = buildFleet(store, BASE_MS + 130_000)[0]!
    expect(recurso.posicionesInvalidas).toBe(1)
    expect(recurso.trail).toHaveLength(2)
  })

  it('ordena por frescura (live primero) y luego por label', () => {
    const ahora = BASE_MS + 1000_000
    const { store } = mergePositions(new Map(), [
      posicion('viejo', (1000_000 - 600_000) / 1000, { hgExtName: 'ZZZ' }), // hace 10 min → stale
      posicion('fresco', (1000_000 - 30_000) / 1000, { hgExtName: 'AAA' }), // hace 30 s → live
    ])
    const flota = buildFleet(store, ahora)
    expect(flota[0]!.esn).toBe('fresco')
    expect(flota[0]!.freshness).toBe('live')
    expect(flota[1]!.freshness).toBe('stale')
  })
})

describe('maxDataCtrTime — candidato a cursor', () => {
  it('devuelve el máximo dataCtrTime de la tanda', () => {
    const posiciones = [
      posicion('A', 0),
      posicion('A', 300),
      posicion('A', 120),
    ]
    expect(maxDataCtrTime(posiciones)).toBe(posiciones[1]!.dataCtrTime)
  })
  it('lista vacía → null', () => {
    expect(maxDataCtrTime([])).toBeNull()
  })
})
