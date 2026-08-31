/**
 * §11 Fase 2-7: el histórico es UNA consulta al backend por rango libre —
 * sin paginar en el navegador, sin la ventana de 6 h del modo vivo, y con el
 * staleness calculado respecto del FIN del rango.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api/client')>()
  return { ...real, getApi: vi.fn() }
})

import { ApiNoDisponibleError, getApi, type Parametros } from '../src/api/client'
import { useHistorico } from '../src/hooks/useHistorico'

const getApiMock = vi.mocked(getApi)

const DESDE = '2026-07-20T00:00:00.000Z'
const HASTA = '2026-07-20T12:00:00.000Z'

function feature(esn: string, posIso: string) {
  return {
    type: 'Feature',
    properties: { esn, posTime: posIso, dataCtrTime: posIso },
    geometry: { type: 'Point', coordinates: [-71.5, -35.5] },
  }
}

function fc(features: unknown[], extra: Record<string, unknown> = {}) {
  return { type: 'FeatureCollection', features, ...extra }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useHistorico', () => {
  it('hace UNA sola consulta con el rango pedido', async () => {
    getApiMock.mockResolvedValue(
      fc([feature('A', '2026-07-20T01:00:00Z'), feature('A', '2026-07-20T02:00:00Z')]),
    )

    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })

    expect(getApiMock).toHaveBeenCalledTimes(1)
    const [ruta, parametros] = getApiMock.mock.calls[0]!
    expect(ruta).toBe('posiciones')
    expect((parametros as Parametros).desde).toBe(DESDE)
    expect((parametros as Parametros).hasta).toBe(HASTA)

    expect(result.current.estado.fase).toBe('ok')
    expect(result.current.estado.posiciones).toBe(2)
  })

  it('conserva rangos más largos que la ventana de 6 h del modo vivo', async () => {
    getApiMock.mockResolvedValue(
      fc([
        feature('A', '2026-07-20T00:30:00Z'),
        feature('A', '2026-07-20T11:30:00Z'), // 11 h después
      ]),
    )

    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })

    expect(result.current.estado.fleet[0]!.trail).toHaveLength(2)
  })

  it('la frescura se calcula respecto del FIN del rango', async () => {
    // última posición 1 h antes del fin del rango -> "sin señal" en ese momento
    getApiMock.mockResolvedValue(fc([feature('A', '2026-07-20T11:00:00Z')]))

    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })

    const recurso = result.current.estado.fleet[0]!
    expect(recurso.staleSeconds).toBe(3600)
    expect(recurso.freshness).toBe('stale')
  })

  it('propaga el aviso de truncado del backend', async () => {
    getApiMock.mockResolvedValue(fc([feature('A', '2026-07-20T01:00:00Z')], { truncado: true }))

    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })

    expect(result.current.estado.truncado).toBe(true)
  })

  it('rango sin datos → fase "vacio"', async () => {
    getApiMock.mockResolvedValue(fc([]))

    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })

    expect(result.current.estado.fase).toBe('vacio')
    expect(result.current.estado.fleet).toHaveLength(0)
  })

  it('error del backend → fase "error"', async () => {
    getApiMock.mockRejectedValue(new ApiNoDisponibleError(503, { status: 'degraded' }))

    const { result } = renderHook(() => useHistorico())
    await act(async () => {
      await result.current.consultar(DESDE, HASTA)
    })

    expect(result.current.estado.fase).toBe('error')
  })

  it('limpiar() vuelve a inactivo', async () => {
    getApiMock.mockResolvedValue(fc([]))

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
