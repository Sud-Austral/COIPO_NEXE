/**
 * §12: la salud de la ingesta llega a la UI.
 *
 * Regresión de un agujero real: `/api/estado-ingesta` existía, estaba bien
 * diseñado y NADIE lo consultaba. Con la ingesta muerta el visor mostraba
 * "Conectado" sobre un mapa vacío, indistinguible de una tarde sin vuelos.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api/client')>()
  return { ...real, getApi: vi.fn() }
})

import { ApiNoDisponibleError, getApi } from '../src/api/client'
import { useEstadoIngesta } from '../src/hooks/useEstadoIngesta'

const getApiMock = vi.mocked(getApi)

const SANA = {
  cursor: '2026-07-30T12:00:00.000Z',
  ultimaCorridaOkEn: '2026-07-30T11:59:30.000Z',
  minutosDesdeUltimaCorridaOk: 0.5,
  ingestaDetenida: false,
  ultimoErrorClase: null,
}

const MUERTA = {
  ...SANA,
  minutosDesdeUltimaCorridaOk: 47.2,
  ingestaDetenida: true,
  ultimoErrorClase: 'ClaveRechazada',
}

/** Con timers falsos, `waitFor` de RTL no avanza: hay que empujarlos a mano. */
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
  getApiMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useEstadoIngesta', () => {
  it('consulta de inmediato, sin esperar al primer intervalo', async () => {
    getApiMock.mockResolvedValue(SANA)
    const { result } = renderHook(() => useEstadoIngesta())
    await flush()

    expect(getApiMock).toHaveBeenCalledWith('estado-ingesta')
    expect(result.current?.ingestaDetenida).toBe(false)
  })

  it('expone la ingesta detenida con sus minutos y la CLASE del error', async () => {
    getApiMock.mockResolvedValue(MUERTA)
    const { result } = renderHook(() => useEstadoIngesta())
    await flush()

    expect(result.current?.ingestaDetenida).toBe(true)
    expect(result.current?.minutosDesdeUltimaCorridaOk).toBe(47.2)
    // La clase, nunca el mensaje crudo: no debe poder filtrar la api-key.
    expect(result.current?.ultimoErrorClase).toBe('ClaveRechazada')
  })

  it('vuelve a consultar en cada intervalo', async () => {
    getApiMock.mockResolvedValue(SANA)
    renderHook(() => useEstadoIngesta(60_000))
    await flush()
    expect(getApiMock).toHaveBeenCalledTimes(1)

    await avanzar(60_000)
    expect(getApiMock).toHaveBeenCalledTimes(2)
  })

  it('un fallo de red NO tumba el visor: conserva lo último conocido', async () => {
    getApiMock.mockResolvedValue(MUERTA)
    const { result } = renderHook(() => useEstadoIngesta(60_000))
    await flush()
    expect(result.current?.ingestaDetenida).toBe(true)

    getApiMock.mockRejectedValue(new ApiNoDisponibleError(null))
    await avanzar(60_000)

    expect(result.current?.ingestaDetenida).toBe(true)
  })

  it('si el contrato cambia, se degrada a null en vez de reventar', async () => {
    getApiMock.mockResolvedValue(MUERTA)
    const { result } = renderHook(() => useEstadoIngesta(60_000))
    await flush()
    expect(result.current).not.toBeNull()

    getApiMock.mockResolvedValue({ otraCosa: 1 })
    await avanzar(60_000)

    expect(result.current).toBeNull()
  })
})
