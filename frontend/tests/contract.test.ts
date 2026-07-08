import { describe, expect, it } from 'vitest'
import { buildGetBody, buildLastPositionsBody, NEXE_TYPE } from '../src/api/contract'

const FECHA = '2026-07-03T10:00:00.000Z'

describe('contract.ts — builders del body (§8.1)', () => {
  it('nunca produce listas vacías (regresión directa del 500 real)', () => {
    for (const body of [buildGetBody(FECHA), buildLastPositionsBody(FECHA)]) {
      expect(body.dataCenter.length).toBeGreaterThan(0)
      expect(body.msgRequest.length).toBeGreaterThan(0)
    }
  })

  it('type es exactamente "dataRequest"', () => {
    expect(NEXE_TYPE).toBe('dataRequest')
    expect(buildGetBody(FECHA).type).toBe('dataRequest')
  })

  it('el filtro va en msgRequest[0].dataCtrTime (contrato real)', () => {
    const body = buildGetBody(FECHA)
    expect(body.msgRequest[0]!.dataCtrTime).toBe(FECHA)
  })

  it('imita el ejemplo oficial: placeholders "string" y reqTime ISO con ms', () => {
    const body = buildGetBody(FECHA)
    const dc = body.dataCenter[0]!
    expect(dc.affVer).toBe('string')
    expect(dc.name).toBe('string')
    // ISO 8601 UTC con milisegundos y Z: 2026-07-03T13:12:06.137Z
    expect(dc.reqTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const msg = body.msgRequest[0]!
    expect(msg.to).toBe('string')
    expect(msg.from).toBe('string')
    expect(msg.msgType).toBe('string')
  })

  it('lastpositions: domain SOLO va cuando se filtra, y como LISTA (422 real si va string)', () => {
    const sinFiltro = buildLastPositionsBody(FECHA)
    expect('domain' in sinFiltro.msgRequest[0]!).toBe(false)

    const conFiltro = buildLastPositionsBody(FECHA, 'rotary')
    expect(conFiltro.msgRequest[0]!.domain).toEqual(['rotary'])
  })
})
