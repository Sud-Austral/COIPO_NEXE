/**
 * §12: el cursor avanza al max(dataCtrTime) y NUNCA retrocede; paginación
 * cuando la tanda viene llena; backoff ante 5xx; detención ante 401/422.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api/client')>()
  return { ...real, postNexe: vi.fn() }
})

import {
  NexeAuthError,
  NexeContractError,
  NexeUpstreamError,
  postNexe,
} from '../src/api/client'
import type { NexeRequest } from '../src/api/contract'
import { usePolling } from '../src/hooks/usePolling'

const postNexeMock = vi.mocked(postNexe)

const T0 = '2026-07-03T12:00:00.000Z'
const CURSOR_INICIAL = '2026-07-03T10:00:00.000Z' // T0 − 2 h

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

describe('usePolling — cursor por dataCtrTime (§8.3)', () => {
  it('parte en ahora − 2 h, avanza al max(dataCtrTime) y NUNCA retrocede', async () => {
    const respuestasGet: unknown[] = [
      fc([
        feature('A', '2026-07-03T10:59:00Z', '2026-07-03T10:59:30.000Z'),
        feature('A', '2026-07-03T11:00:00Z', '2026-07-03T11:00:30.000Z'), // máx
      ]),
      // 2º ciclo: solo un histórico rezagado, MÁS VIEJO que el cursor
      fc([feature('A', '2026-07-03T10:30:00Z', '2026-07-03T10:30:10.000Z')]),
      fc([]),
    ]
    postNexeMock.mockImplementation(async (ruta) => {
      if (ruta === 'lastpositions') return fc([])
      return respuestasGet.shift() ?? fc([])
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(cuerposGet()[0]!.msgRequest[0]!.dataCtrTime).toBe(CURSOR_INICIAL)
    expect(result.current.cursor).toBe('2026-07-03T11:00:30.000Z')
    expect(result.current.fase).toBe('ok')
    expect(result.current.fleet).toHaveLength(1)

    await avanzar(30_000) // 2º poll: pide desde el cursor avanzado
    expect(cuerposGet()[1]!.msgRequest[0]!.dataCtrTime).toBe('2026-07-03T11:00:30.000Z')
    // el histórico rezagado NO retrocede el cursor…
    expect(result.current.cursor).toBe('2026-07-03T11:00:30.000Z')
    // …pero sí se incorpora a la traza (dedupe aparte)
    expect(result.current.fleet[0]!.trail.length).toBe(3)

    await avanzar(30_000) // 3er poll: cursor intacto
    expect(cuerposGet()[2]!.msgRequest[0]!.dataCtrTime).toBe('2026-07-03T11:00:30.000Z')
  })

  it('pagina dentro del mismo ciclo cuando la tanda viene llena (límite ~1000)', async () => {
    const paginaLlena = fc(
      Array.from({ length: 950 }, (_, i) =>
        feature(
          'A',
          new Date(Date.parse('2026-07-03T10:00:00Z') + i * 1000).toISOString(),
          new Date(Date.parse('2026-07-03T10:00:05Z') + i * 1000).toISOString(),
        ),
      ),
    )
    const paginaCorta = fc([feature('A', '2026-07-03T11:59:00Z', '2026-07-03T11:59:10.000Z')])
    const respuestasGet = [paginaLlena, paginaCorta]
    postNexeMock.mockImplementation(async (ruta) => {
      if (ruta === 'lastpositions') return fc([])
      return respuestasGet.shift() ?? fc([])
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    const cuerpos = cuerposGet()
    expect(cuerpos).toHaveLength(2) // dos páginas en UN ciclo (sin esperar 30 s)
    // la 2ª página pide desde el máx dataCtrTime de la 1ª
    const maxPagina1 = new Date(Date.parse('2026-07-03T10:00:05Z') + 949 * 1000).toISOString()
    expect(cuerpos[1]!.msgRequest[0]!.dataCtrTime).toBe(maxPagina1)
    expect(result.current.contadorPolls).toBe(1)
  })

  it('5xx/red → backoff exponencial SIN resetear el cursor', async () => {
    postNexeMock.mockImplementation(async (ruta) => {
      if (ruta === 'lastpositions') return fc([])
      throw new NexeUpstreamError(500, 'Internal Server Error')
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(result.current.fase).toBe('reintentando')
    expect(result.current.error?.tipo).toBe('red')
    expect(cuerposGet()).toHaveLength(1)

    await avanzar(5_000) // 1er reintento a los 5 s
    expect(cuerposGet()).toHaveLength(2)
    await avanzar(10_000) // 2º a los 10 s
    expect(cuerposGet()).toHaveLength(3)
    // el cursor jamás se reseteó
    for (const body of cuerposGet()) {
      expect(body.msgRequest[0]!.dataCtrTime).toBe(CURSOR_INICIAL)
    }
  })

  it('401 → detiene el polling (no reintenta en loop)', async () => {
    postNexeMock.mockImplementation(async (ruta) => {
      if (ruta === 'lastpositions') return fc([])
      throw new NexeAuthError({ detail: 'Incorrect api key or JWT Token' })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(result.current.fase).toBe('detenido')
    expect(result.current.error?.tipo).toBe('auth')
    const llamadas = cuerposGet().length
    await avanzar(120_000)
    expect(cuerposGet()).toHaveLength(llamadas) // ni una llamada más
  })

  it('422 → detiene el polling con el detail técnico', async () => {
    const detail = [{ type: 'missing', loc: ['body', 'msgRequest'], msg: 'Field required' }]
    postNexeMock.mockImplementation(async (ruta) => {
      if (ruta === 'lastpositions') return fc([])
      throw new NexeContractError({ detail })
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    expect(result.current.fase).toBe('detenido')
    expect(result.current.error?.tipo).toBe('contrato')
    expect(result.current.error?.detalle).toEqual({ detail })
    const llamadas = cuerposGet().length
    await avanzar(120_000)
    expect(cuerposGet()).toHaveLength(llamadas)
  })

  it('los metadatos de lastpositions se fusionan en la flota', async () => {
    postNexeMock.mockImplementation(async (ruta) => {
      if (ruta === 'lastpositions') {
        return fc([
          {
            type: 'Feature',
            properties: {
              esn: 'A',
              posTime: '2026-07-03T11:58:00Z',
              dataCtrTime: '2026-07-03T11:58:10.000Z',
              hgExtName: 'HT-01',
              hgAsset: 'CC-AQY',
              hgNavstate: '5',
              hgCompany: 'CONAF',
            },
            geometry: { type: 'Point', coordinates: [-71.5, -35.5] },
          },
        ])
      }
      return fc([feature('A', '2026-07-03T11:59:00Z', '2026-07-03T11:59:10.000Z')])
    })

    const { result } = renderHook(() => usePolling(2))
    await flush()

    const recurso = result.current.fleet[0]!
    expect(recurso.label).toBe('HT-01')
    expect(recurso.navState).toBe(5)
    expect(recurso.last.hgAsset).toBe('CC-AQY')
    // la telemetría sigue siendo la más reciente (la del /get)
    expect(recurso.last.posTime).toBe('2026-07-03T11:59:00Z')
  })
})
