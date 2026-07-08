import { describe, expect, it } from 'vitest'
import { validarBodyNexe } from '../server/validacionNexe'

const VALIDO = {
  type: 'dataRequest',
  dataCenter: [{ affVer: 'string', name: 'string', reqTime: '2026-07-03T10:00:00.000Z' }],
  msgRequest: [{ to: 'string', from: 'string', msgType: 'string', dataCtrTime: '2026-07-01T00:00:00.000Z' }],
}

describe('validarBodyNexe — réplica del servidor real (§9)', () => {
  it('body válido pasa', () => {
    const r = validarBodyNexe(VALIDO)
    expect(r.ok).toBe(true)
  })

  it('campo raíz faltante → 422 Field required con loc correcta', () => {
    const r = validarBodyNexe({ type: 'dataRequest', dataCenter: [] })
    expect(r.ok).toBe(false)
    if (!r.ok && r.status === 422) {
      expect(r.detail).toContainEqual({
        type: 'missing',
        loc: ['body', 'msgRequest'],
        msg: 'Field required',
      })
    } else {
      expect.unreachable('debió ser 422')
    }
  })

  it('type incorrecto → 422 "Input should be \'dataRequest\'"', () => {
    const r = validarBodyNexe({ ...VALIDO, type: 'otro' })
    expect(r.ok).toBe(false)
    if (!r.ok && r.status === 422) {
      expect(r.detail.some((d) => d.msg === "Input should be 'dataRequest'")).toBe(true)
    }
  })

  it('no-lista → 422 "Input should be a valid list"', () => {
    const r = validarBodyNexe({ ...VALIDO, msgRequest: 'no-lista' })
    expect(r.ok).toBe(false)
    if (!r.ok && r.status === 422) {
      expect(r.detail.some((d) => d.msg === 'Input should be a valid list')).toBe(true)
    }
  })

  it('listas vacías pasan la validación pero → 500 (comportamiento real)', () => {
    const r = validarBodyNexe({ ...VALIDO, dataCenter: [], msgRequest: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(500)
  })
})
