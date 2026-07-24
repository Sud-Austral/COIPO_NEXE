import { describe, expect, it } from 'vitest'
import { detectarTransiciones, instantaneaFrescura } from '../src/domain/alertas'
import type { FleetResource, Freshness } from '../src/domain/types'

function recurso(esn: string, freshness: Freshness): FleetResource {
  return {
    esn,
    label: esn.toUpperCase(),
    last: {
      esn,
      posTime: '2026-07-08T12:00:00Z',
      dataCtrTime: '2026-07-08T12:00:30Z',
      latitude: -35.5,
      longitude: -71.5,
    },
    trail: [],
    navState: null,
    staleSeconds: freshness === 'stale' ? 700 : 30,
    freshness,
    posicionesInvalidas: 0,
  }
}

const AHORA = Date.parse('2026-07-08T12:00:00Z')

describe('detectarTransiciones (§11 Fase 2-10)', () => {
  it('live → stale genera alerta "sin-senal"', () => {
    const previas = new Map<string, Freshness>([['a', 'live']])
    const alertas = detectarTransiciones(previas, [recurso('a', 'stale')], AHORA)
    expect(alertas).toHaveLength(1)
    expect(alertas[0]!.tipo).toBe('sin-senal')
    expect(alertas[0]!.label).toBe('A')
  })

  it('stale → live genera alerta "recuperado"', () => {
    const previas = new Map<string, Freshness>([['a', 'stale']])
    const alertas = detectarTransiciones(previas, [recurso('a', 'live')], AHORA)
    expect(alertas).toHaveLength(1)
    expect(alertas[0]!.tipo).toBe('recuperado')
  })

  it('primera aparición NO alerta (sin transición conocida)', () => {
    const alertas = detectarTransiciones(new Map(), [recurso('a', 'stale')], AHORA)
    expect(alertas).toHaveLength(0)
  })

  it('live → delayed NO alerta (solo cruces del umbral stale)', () => {
    const previas = new Map<string, Freshness>([['a', 'live']])
    expect(detectarTransiciones(previas, [recurso('a', 'delayed')], AHORA)).toHaveLength(0)
  })

  it('delayed → stale SÍ alerta', () => {
    const previas = new Map<string, Freshness>([['a', 'delayed']])
    expect(detectarTransiciones(previas, [recurso('a', 'stale')], AHORA)).toHaveLength(1)
  })

  it('instantaneaFrescura refleja el estado actual por ESN', () => {
    const mapa = instantaneaFrescura([recurso('a', 'live'), recurso('b', 'stale')])
    expect(mapa.get('a')).toBe('live')
    expect(mapa.get('b')).toBe('stale')
  })
})
