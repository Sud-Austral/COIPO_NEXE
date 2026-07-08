import { describe, expect, it } from 'vitest'
import { NexeRespuestaError, parsePositions } from '../src/api/parse'
import fixtureGet from './fixtures/respuesta_get_real.json'
import fixtureLast from './fixtures/respuesta_lastpositions_real.json'

describe('parsePositions — contrato real (FeatureCollection)', () => {
  it('aplana la respuesta real de /get: coordenadas [lon, lat] → latitude/longitude', () => {
    const { posiciones, descartadas } = parsePositions(fixtureGet)
    expect(descartadas).toBe(0)
    expect(posiciones).toHaveLength(4)

    const primera = posiciones[0]!
    expect(primera.esn).toBe('860000000000001')
    expect(primera.latitude).toBe(-32.946836) // coordinates[1]
    expect(primera.longitude).toBe(-71.542791) // coordinates[0]
    expect(primera.heading).toBe(179) // cog
    expect(primera.speed).toBe(0) // spd
    expect(primera.fixType).toBe('2D') // fix
    expect(primera.pdop).toBe(1)
    expect(primera.src).toBe('GPS')
    expect(primera.hgExtName).toBe('Movil-A')
    // conserva los microsegundos del dataCtrTime real (clave del cursor)
    expect(primera.dataCtrTime).toBe('2026-06-19T00:37:09.561041Z')
  })

  it('mapea los metadatos hg* de get_lastpositions, con hgNavstate string → número', () => {
    const { posiciones } = parsePositions(fixtureLast)
    expect(posiciones).toHaveLength(2)
    const movilB = posiciones.find((p) => p.esn === '860000000000002')!
    expect(movilB.hgNavstate).toBe(2) // "2" → 2
    expect(movilB.hgAsset).toBe('VG-XX01')
    expect(movilB.hgAssetModel).toBe('Peugeot Boxer')
    expect(movilB.hgAssetFamily).toBe('Furgonetas')
    expect(movilB.hgFamilyType).toBe('ground')
    expect(movilB.hgCompany).toBe('CONAF')
    expect(movilB.unitId).toBe('VG-XX01')
  })

  it('FeatureCollection con features vacías → cero posiciones (sin error)', () => {
    const { posiciones } = parsePositions({ type: 'FeatureCollection', dataInfo: [], features: [] })
    expect(posiciones).toEqual([])
  })
})

describe('parsePositions — fallbacks tolerantes (§8.2)', () => {
  const registro = {
    esn: 'X1',
    posTime: '2026-07-03T12:00:00Z',
    dataCtrTime: '2026-07-03T12:00:30Z',
    latitude: -35.5,
    longitude: -71.5,
  }

  it('(a) lista directa de objetos', () => {
    const { posiciones } = parsePositions([registro])
    expect(posiciones).toHaveLength(1)
    expect(posiciones[0]!.esn).toBe('X1')
  })

  it('(b) objeto con clave positions', () => {
    const { posiciones } = parsePositions({ positions: [registro] })
    expect(posiciones).toHaveLength(1)
  })

  it('(c) objeto con clave desconocida que contiene la lista', () => {
    const { posiciones } = parsePositions({ registrosRaros: [registro] })
    expect(posiciones).toHaveLength(1)
  })

  it('(d) {detail: ...} solo → error tipado (error FastAPI disfrazado)', () => {
    expect(() => parsePositions({ detail: 'Incorrect api key or JWT Token' })).toThrow(
      NexeRespuestaError,
    )
    try {
      parsePositions({ detail: 'x' })
    } catch (error) {
      expect((error as NexeRespuestaError).tipo).toBe('error_disfrazado')
    }
  })

  it('formato irreconocible → error tipado formato_desconocido', () => {
    expect(() => parsePositions(42)).toThrow(NexeRespuestaError)
    expect(() => parsePositions({ nada: 'aqui' })).toThrow(NexeRespuestaError)
  })

  it('normaliza alias con tolerancia de mayúsculas (lat/lon/alt)', () => {
    const { posiciones } = parsePositions([
      {
        ESN: 'X2',
        PosTime: '2026-07-03T12:00:00Z',
        DataCtrTime: '2026-07-03T12:00:10Z',
        Lat: -35.1,
        Lon: -71.1,
        Alt: 820,
        Spd: '42',
      },
    ])
    expect(posiciones).toHaveLength(1)
    expect(posiciones[0]!.latitude).toBe(-35.1)
    expect(posiciones[0]!.altitude).toBe(820)
    expect(posiciones[0]!.speed).toBe(42) // string numérico → número
  })

  it('descarta registros sin esenciales (esn/posTime/lat/lon)', () => {
    const { posiciones, descartadas } = parsePositions([
      { esn: 'X3', posTime: '2026-07-03T12:00:00Z' }, // sin coordenadas
      registro,
    ])
    expect(posiciones).toHaveLength(1)
    expect(descartadas).toBe(1)
  })

  it('sin dataCtrTime usa posTime (no retrocede el cursor)', () => {
    const { posiciones } = parsePositions([
      { esn: 'X4', posTime: '2026-07-03T12:00:00Z', lat: -35, lon: -71 },
    ])
    expect(posiciones[0]!.dataCtrTime).toBe('2026-07-03T12:00:00Z')
  })
})
