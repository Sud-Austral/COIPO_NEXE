/**
 * §11 Fase 2-7: consulta única paginada por rango libre — pagina mientras la
 * tanda venga llena, filtra por posTime al rango, staleness relativo a `hasta`
 * y sin la ventana de 6 h del modo vivo.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api/client')>()
  return { ...real, postNexe: vi.fn() }
})

import { postNexe, NexeUpstreamError } from '../src/api/client'
import type { NexeRequest } from '../src/api/contract'
import { useHistorico } from '../src/hooks/useHistorico'

const postNexeMock = vi.mocked(postNexe)

function feature(esn: string, posIso: string, ctrIso: string) {
  return {
    type: 'Feature',
    properties: { esn, posTime: posIso, dataCtrTime: ctrIso },
    geometry: { type: 'Point', coordinates: [-71.5, -35.5] },
  }
}

function fc(features: unknown[]) {
  return { type: 'FeatureCollection', dataInfo: [], features }
}

function cuerposGet(): NexeRequest[] {
  return postNexeMock.mock.calls
    .filter(([ruta]) => ruta === 'get')
    .map(([, body]) => body)
}

afterEach(() => {
  vi.clearAllMocks()
})

const DESDE = '2026-06-20T00:00:00.000Z'
const HASTA = '2026-06-20T12:00:00.000Z'

describe('useHistorico', () => {
  it('consulta única: pagina mientras la tanda venga llena y arma la flota', async () => {
    const paginaLlena = fc(
      Array.from({ length: 950 }, (_, i) =>
        feature(
          'A',
          new Date(Date.parse('2026-06-20T01:00:00Z') + i * 1000).toISOString(),
          new Date(Date.parse('2026-06-20T01:00:05Z') + i * 1000).toISOString(),
        ),
      ),
    )
    const paginaCorta = fc([
      feature('A', '2026-06-20T11:00:00Z', '2026-06-20T11:00:10.000Z'),
      // fuera del rango pedido (posTime > hasta): se descarta
      feature('A', '2026-06-20T13:00:00Z', '2026-06-20T13:00:10.000Z'),
    ])
    const paginas = [paginaLlena, paginaCorta]
    postNexeMock.mockImplementation(async () => paginas.shift() ?? fc([]))

    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })

    expect(cuerposGet()).toHaveLength(2)
    expect(cuerposGet()[0]!.msgRequest[0]!.dataCtrTime).toBe(DESDE)
    expect(result.current.estado.fase).toBe('ok')
    expect(result.current.estado.posiciones).toBe(951) // la fuera de rango no cuenta
    expect(result.current.estado.paginasCargadas).toBe(2)
    expect(result.current.estado.truncado).toBe(false)

    const recurso = result.current.estado.fleet[0]!
    // sin la ventana de 6 h del modo vivo: el rango completo (10 h) sobrevive,
    // acotado solo por el tope de 1000 puntos por ESN
    expect(recurso.trail.length).toBe(951)
    // staleness relativo al FIN del rango: última posición 11:00 → 1 h → stale
    expect(recurso.freshness).toBe('stale')
    expect(recurso.staleSeconds).toBe(3600)
  })

  it('rango sin datos → fase "vacio"', async () => {
    postNexeMock.mockImplementation(async () => fc([]))
    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })
    expect(result.current.estado.fase).toBe('vacio')
    expect(result.current.estado.fleet).toHaveLength(0)
  })

  it('error de red → fase "error"', async () => {
    postNexeMock.mockImplementation(async () => {
      throw new NexeUpstreamError(500, 'Internal Server Error')
    })
    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })
    expect(result.current.estado.fase).toBe('error')
  })

  it('limpiar() vuelve a inactivo', async () => {
    postNexeMock.mockImplementation(async () => fc([]))
    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })
    act(() => {
      result.current.limpiar()
    })
    expect(result.current.estado.fase).toBe('inactivo')
  })
})
