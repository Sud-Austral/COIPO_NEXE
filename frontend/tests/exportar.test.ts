import { describe, expect, it } from 'vitest'
import { aCSV, aGeoJSON } from '../src/lib/exportar'
import type { FleetResource, NexePosition } from '../src/domain/types'

function posicion(extra: Partial<NexePosition> = {}): NexePosition {
  return {
    esn: 'A1',
    posTime: '2026-07-08T12:00:00Z',
    dataCtrTime: '2026-07-08T12:00:30Z',
    latitude: -35.5,
    longitude: -71.5,
    speed: 67,
    heading: 180,
    fixType: '3D',
    hgExtName: 'HT-01',
    ...extra,
  }
}

function recurso(trail: NexePosition[], last = trail[trail.length - 1]!): FleetResource {
  return {
    esn: last.esn,
    label: last.hgExtName ?? last.esn,
    last,
    trail,
    navState: 5,
    staleSeconds: 30,
    freshness: 'live',
    posicionesInvalidas: 0,
  }
}

describe('aGeoJSON — export compatible QGIS/kepler.gl (§11 Fase 2-8)', () => {
  it('produce FeatureCollection de Points con coordenadas [lon, lat]', () => {
    const r = recurso([posicion(), posicion({ posTime: '2026-07-08T12:02:00Z', latitude: -35.6 })])
    const geojson = JSON.parse(aGeoJSON([r])) as {
      type: string
      features: Array<{
        type: string
        geometry: { type: string; coordinates: [number, number] }
        properties: Record<string, unknown>
      }>
    }
    expect(geojson.type).toBe('FeatureCollection')
    expect(geojson.features).toHaveLength(2)
    const f = geojson.features[0]!
    expect(f.geometry.type).toBe('Point')
    expect(f.geometry.coordinates).toEqual([-71.5, -35.5]) // [lon, lat]
    expect(f.properties.esn).toBe('A1')
    expect(f.properties.posTime).toBe('2026-07-08T12:00:00Z')
    expect(f.properties.hgExtName).toBe('HT-01')
  })

  it('incluye la última posición aunque no esté en la trail (todas Invalid)', () => {
    const invalida = posicion({ fixType: 'Invalid' })
    const r = recurso([], invalida)
    const geojson = JSON.parse(aGeoJSON([r])) as { features: unknown[] }
    expect(geojson.features).toHaveLength(1)
  })
})

describe('aCSV — RFC 4180', () => {
  it('encabezado + una fila por posición, con lat/lon numéricos', () => {
    const r = recurso([posicion()])
    const lineas = aCSV([r]).split('\r\n')
    expect(lineas[0]!.startsWith('esn,label,posTime,dataCtrTime,latitude,longitude')).toBe(true)
    expect(lineas).toHaveLength(2)
    expect(lineas[1]).toContain('-35.5')
    expect(lineas[1]).toContain('-71.5')
  })

  it('escapa comas y comillas según RFC 4180', () => {
    const r = recurso([
      posicion({ hgAssetModel: 'Bell 412, "EP"', hgAlias: 'Alias, con coma' }),
    ])
    const csv = aCSV([r])
    expect(csv).toContain('"Bell 412, ""EP"""')
    expect(csv).toContain('"Alias, con coma"')
  })

  it('campos ausentes quedan vacíos (sin "undefined")', () => {
    const r = recurso([posicion({ altitude: undefined, pdop: undefined })])
    expect(aCSV([r])).not.toContain('undefined')
  })
})
