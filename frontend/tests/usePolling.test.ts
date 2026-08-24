/**
 * §12: el cursor avanza con el `siguienteCursor` del backend y NUNCA retrocede;
 * se encadenan tandas mientras el backend avise `hayMas`; backoff ante 5xx/red;
 * detención ante una consulta rechazada (4xx).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api/client')>()
  return { ...real, getApi: vi.fn() }
})

import {
  ApiNoDisponibleError,
  ApiRequestError,
  getApi,
  type Parametros,
  type RutaApi,
} from '../src/api/client'
import { usePolling } from '../src/hooks/usePolling'

const getApiMock = vi.mocked(getApi)

const T0 = '2026-07-30T12:00:00.000Z'
const CURSOR_INICIAL = '2026-07-30T10:00:00.000Z' // T0 − 2 h

function feature(esn: string, posIso: string, ctrIso: string) {
  return {
    type: 'Feature',
    properties: { esn, posTime: posIso, dataCtrTime: ctrIso },
    geometry: { type: 'Point', coordinates: [-71.5, -35.5] },
  }
}

function fc(features: unknown[], extra: Record<string, unknown> = {}) {
  return { type: 'FeatureCollection', features, ...extra }
}

/** Cursores con los que se llamó a /posiciones/incremental, en orden. */
function cursoresPedidos(): string[] {
  return getApiMock.mock.calls
    .filter(([ruta]) => ruta === 'posiciones/incremental')
    .map(([, parametros]) => String((parametros as Parametros).cursor))
}

function llamadas(ruta: RutaApi): number {
  return getApiMock.mock.calls.filter(([r]) => r === ruta).length
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

async function avanzar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(T0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('usePolling — cursor servido por el backend', () => {
  it('parte en ahora − 2 h, adopta siguienteCursor y NUNCA retrocede', async () => {
    const respuestas: unknown[] = [
      fc(
        [
          feature('A', '2026-07-30T10:59:00Z', '2026-07-30T10:59:30.000000Z'),
          feature('A', '2026-07-30T11:00:00Z', '2026-07-30T11:00:30.000000Z'),
        ],
        { siguienteCursor: '2026-07-30T11:00:30.000000Z', hayMas: false },
      ),
      // 2º ciclo: sin novedades — el backend devuelve el mismo cursor
      fc([], { siguienteCursor: '2026-07-30T11:00:30.000000Z', hayMas: false }),
      fc([], { siguienteCursor: '2026-07-30T11:00:30.000000Z', hayMas: false }),
    ]
    getApiMock.mockImplementation(async (ruta) => {
      if (ruta === 'recursos') return fc([])
      return respuestas.shift() ?? fc([], { siguienteCursor: CURSOR_INICIAL })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(cursoresPedidos()[0]).toBe(CURSOR_INICIAL)
    expect(result.current.cursor).toBe('2026-07-30T11:00:30.000000Z')
    expect(result.current.fase).toBe('ok')
    expect(result.current.fleet).toHaveLength(1)

    await avanzar(30_000)
    expect(cursoresPedidos()[1]).toBe('2026-07-30T11:00:30.000000Z')
    // un cursor igual (o menor) no mueve nada
    expect(result.current.cursor).toBe('2026-07-30T11:00:30.000000Z')

    await avanzar(30_000)
    expect(cursoresPedidos()[2]).toBe('2026-07-30T11:00:30.000000Z')
  })

  it('un siguienteCursor MENOR que el actual se ignora', async () => {
    getApiMock.mockImplementation(async (ruta) => {
      if (ruta === 'recursos') return fc([])
      return fc([feature('A', '2026-07-30T09:00:00Z', '2026-07-30T09:00:10.000000Z')], {
        siguienteCursor: '2026-07-30T09:00:10.000000Z', // anterior al cursor inicial
        hayMas: false,
      })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(result.current.cursor).toBe(CURSOR_INICIAL)
  })

  it('encadena tandas mientras el backend avise hayMas', async () => {
    const respuestas = [
      fc([feature('A', '2026-07-30T11:00:00Z', '2026-07-30T11:00:30.000000Z')], {
        siguienteCursor: '2026-07-30T11:00:30.000000Z',
        hayMas: true,
      }),
      fc([feature('A', '2026-07-30T11:30:00Z', '2026-07-30T11:30:30.000000Z')], {
        siguienteCursor: '2026-07-30T11:30:30.000000Z',
        hayMas: false,
      }),
    ]
    getApiMock.mockImplementation(async (ruta) => {
      if (ruta === 'recursos') return fc([])
      return respuestas.shift() ?? fc([], { siguienteCursor: CURSOR_INICIAL })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    // dos tandas dentro de UN ciclo, sin esperar los 30 s
    expect(llamadas('posiciones/incremental')).toBe(2)
    expect(result.current.contadorPolls).toBe(1)
    expect(result.current.cursor).toBe('2026-07-30T11:30:30.000000Z')
    expect(result.current.fleet[0]!.trail).toHaveLength(2)
  })

  it('5xx/red → backoff exponencial SIN resetear el cursor', async () => {
    getApiMock.mockImplementation(async (ruta) => {
      if (ruta === 'recursos') return fc([])
      throw new ApiNoDisponibleError(503, { status: 'degraded' })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(result.current.fase).toBe('reintentando')
    expect(result.current.error?.tipo).toBe('red')
    expect(llamadas('posiciones/incremental')).toBe(1)

    await avanzar(5_000)
    expect(llamadas('posiciones/incremental')).toBe(2)
    await avanzar(10_000)
    expect(llamadas('posiciones/incremental')).toBe(3)

    for (const cursor of cursoresPedidos()) {
      expect(cursor).toBe(CURSOR_INICIAL)
    }
  })

  it('4xx → detiene el polling (no se arregla reintentando)', async () => {
    getApiMock.mockImplementation(async (ruta) => {
      if (ruta === 'recursos') return fc([])
      throw new ApiRequestError(400, { detail: 'El inicio del rango debe ser anterior al fin.' })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(result.current.fase).toBe('detenido')
    expect(result.current.error?.tipo).toBe('consulta')
    const antes = llamadas('posiciones/incremental')
    await avanzar(120_000)
    expect(llamadas('posiciones/incremental')).toBe(antes)
  })

  it('los metadatos de /api/recursos se fusionan en la flota', async () => {
    getApiMock.mockImplementation(async (ruta) => {
      if (ruta === 'recursos') {
        return fc([
          {
            type: 'Feature',
            properties: {
              esn: 'A',
              posTime: '2026-07-30T11:58:00Z',
              dataCtrTime: '2026-07-30T11:58:10.000000Z',
              hgExtName: 'AC-02',
              hgAsset: 'CC-DLW',
              hgNavstate: 5,
              hgCompany: 'CONAF',
            },
            geometry: { type: 'Point', coordinates: [-71.5, -35.5] },
          },
        ])
      }
      return fc([feature('A', '2026-07-30T11:59:00Z', '2026-07-30T11:59:10.000000Z')], {
        siguienteCursor: '2026-07-30T11:59:10.000000Z',
        hayMas: false,
      })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    const recurso = result.current.fleet[0]!
    expect(recurso.label).toBe('AC-02')
    expect(recurso.navState).toBe(5)
    expect(recurso.last.hgAsset).toBe('CC-DLW')
    // la telemetría sigue siendo la más reciente
    expect(recurso.last.posTime).toBe('2026-07-30T11:59:00Z')
  })

  it('en modo histórico (activo=false) no consulta nada', async () => {
    getApiMock.mockImplementation(async () => fc([]))
    renderHook(() => usePolling(2, 30_000, false))
    await flush()
    await avanzar(60_000)
    expect(getApiMock).not.toHaveBeenCalled()
  })
})
