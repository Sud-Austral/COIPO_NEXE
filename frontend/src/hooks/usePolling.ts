/**
 * Ciclo de tiempo real contra NUESTRO backend (CLAUDE.md §8.3).
 *
 * Antes el navegador paginaba Nexe (límite 1000 por respuesta) y calculaba el
 * cursor. Ahora el collector hace eso contra Nexe y el backend devuelve el
 * `siguienteCursor` ya calculado: aquí solo queda pedir "lo llegado desde X" y,
 * si la tanda vino tope (`hayMas`), volver a pedir de inmediato.
 *
 * El cursor sigue sin retroceder nunca, y el dedupe por (esn, posTime) se mantiene
 * en el cliente porque el buffer de trazas vive en memoria.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiNoDisponibleError, ApiRequestError, getApi } from '../api/client'
import { NexeRespuestaError, parsePositions } from '../api/parse'
import { buildFleet, mergePositions, type FleetStore } from '../domain/fleet'
import type { FleetResource } from '../domain/types'

export const POLL_INTERVAL_MS = 30_000 // mínimo permitido por el estándar AFF
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000] // tope 60 s
const TICK_FRESCURA_MS = 5_000 // recomputar staleness aunque no lleguen datos
const MAX_TANDAS_POR_CICLO = 8 // cortafuegos si la base trae mucho atraso

export type FasePolling = 'cargando' | 'ok' | 'reintentando' | 'detenido'

export interface ErrorPolling {
  tipo: 'consulta' | 'red'
  mensaje: string
  detalle?: unknown
}

export interface EstadoPolling {
  fase: FasePolling
  error: ErrorPolling | null
  fleet: FleetResource[]
  cursor: string | null
  ultimoPollMs: number | null
  proximoPollMs: number | null
  contadorPolls: number
}

const ESTADO_INICIAL: EstadoPolling = {
  fase: 'cargando',
  error: null,
  fleet: [],
  cursor: null,
  ultimoPollMs: null,
  proximoPollMs: null,
  contadorPolls: 0,
}

/** La respuesta del backend trae el cursor ya calculado. */
function leerSiguienteCursor(cruda: unknown, porDefecto: string): string {
  if (typeof cruda === 'object' && cruda !== null) {
    const valor = (cruda as Record<string, unknown>).siguienteCursor
    if (typeof valor === 'string' && valor !== '') return valor
  }
  return porDefecto
}

function hayMas(cruda: unknown): boolean {
  return (
    typeof cruda === 'object' &&
    cruda !== null &&
    (cruda as Record<string, unknown>).hayMas === true
  )
}

export function usePolling(
  rangoHoras: number = 2,
  intervaloMs: number = POLL_INTERVAL_MS,
  activo: boolean = true, // false = modo histórico: polling completamente detenido
) {
  const intervaloSeguro = Math.max(intervaloMs, POLL_INTERVAL_MS)

  const [estado, setEstado] = useState<EstadoPolling>(ESTADO_INICIAL)

  const storeRef = useRef<FleetStore>(new Map())
  const cursorRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffIndiceRef = useRef(0)
  const enVueloRef = useRef(false)
  const detenidoRef = useRef(false)
  const generacionRef = useRef(0)

  const limpiarTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  /** Metadatos hg* + última posición de cada recurso, en una sola llamada. */
  const refrescarRecursos = useCallback(async () => {
    const cruda = await getApi('recursos')
    const { posiciones } = parsePositions(cruda)
    if (posiciones.length > 0) {
      storeRef.current = mergePositions(storeRef.current, posiciones).store
    }
  }, [])

  const poll = useCallback(async () => {
    const generacion = generacionRef.current
    if (detenidoRef.current || enVueloRef.current) return
    if (typeof document !== 'undefined' && document.hidden) return

    enVueloRef.current = true
    try {
      // 1) trazas nuevas: se repite mientras el backend avise que hay más.
      for (let tanda = 0; tanda < MAX_TANDAS_POR_CICLO; tanda++) {
        const cruda = await getApi('posiciones/incremental', { cursor: cursorRef.current })
        if (generacion !== generacionRef.current) return
        const { posiciones } = parsePositions(cruda)

        if (posiciones.length > 0) {
          storeRef.current = mergePositions(storeRef.current, posiciones).store
        }
        const siguiente = leerSiguienteCursor(cruda, cursorRef.current)
        // el cursor NUNCA retrocede
        if (Date.parse(siguiente) > Date.parse(cursorRef.current)) {
          cursorRef.current = siguiente
        } else {
          break
        }
        if (!hayMas(cruda)) break
      }

      // 2) catálogo: los hg* completos solo existen aquí (no mueve el cursor).
      await refrescarRecursos()
      if (generacion !== generacionRef.current) return

      backoffIndiceRef.current = 0
      const ahora = Date.now()
      limpiarTimer()
      timerRef.current = setTimeout(() => void poll(), intervaloSeguro)
      setEstado((previo) => ({
        fase: 'ok',
        error: null,
        fleet: buildFleet(storeRef.current, ahora),
        cursor: cursorRef.current,
        ultimoPollMs: ahora,
        proximoPollMs: ahora + intervaloSeguro,
        contadorPolls: previo.contadorPolls + 1,
      }))
    } catch (error) {
      if (generacion !== generacionRef.current) return
      const ahora = Date.now()

      // Una consulta mal formada o una respuesta irreconocible no se arregla
      // reintentando: es un desajuste entre frontend y backend.
      if (error instanceof ApiRequestError || error instanceof NexeRespuestaError) {
        detenidoRef.current = true
        setEstado((previo) => ({
          ...previo,
          fase: 'detenido',
          proximoPollMs: null,
          error: {
            tipo: 'consulta',
            mensaje: error.message,
            detalle: error instanceof ApiRequestError ? error.detalle : error.detalle,
          },
        }))
        return
      }

      // 5xx / red: backoff exponencial SIN resetear el cursor.
      const espera = BACKOFF_MS[Math.min(backoffIndiceRef.current, BACKOFF_MS.length - 1)]!
      backoffIndiceRef.current += 1
      limpiarTimer()
      timerRef.current = setTimeout(() => void poll(), espera)
      setEstado((previo) => ({
        ...previo,
        fase: 'reintentando',
        proximoPollMs: ahora + espera,
        error: {
          tipo: 'red',
          mensaje: error instanceof Error ? error.message : 'Error de red',
          detalle: error instanceof ApiNoDisponibleError ? error.detalle : undefined,
        },
      }))
    } finally {
      enVueloRef.current = false
    }
  }, [intervaloSeguro, refrescarRecursos])

  useEffect(() => {
    generacionRef.current += 1
    if (!activo) {
      detenidoRef.current = true
      limpiarTimer()
      return
    }
    const generacion = generacionRef.current
    detenidoRef.current = false
    enVueloRef.current = false
    backoffIndiceRef.current = 0
    storeRef.current = new Map()
    cursorRef.current = new Date(Date.now() - rangoHoras * 3600_000).toISOString()
    setEstado({ ...ESTADO_INICIAL, cursor: cursorRef.current })

    // Pintado inicial en una llamada; la historia la trae el primer incremental.
    void (async () => {
      try {
        await refrescarRecursos()
        if (generacion !== generacionRef.current) return
        if (storeRef.current.size > 0) {
          setEstado((previo) => ({
            ...previo,
            fleet: buildFleet(storeRef.current, Date.now()),
          }))
        }
      } catch {
        // silencioso: el poll inmediato siguiente informa el error real
      }
      if (generacion === generacionRef.current) void poll()
    })()

    const alCambiarVisibilidad = () => {
      if (!document.hidden && !detenidoRef.current) {
        limpiarTimer()
        void poll()
      }
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)

    const tick = setInterval(() => {
      setEstado((previo) =>
        previo.fleet.length === 0
          ? previo
          : { ...previo, fleet: buildFleet(storeRef.current, Date.now()) },
      )
    }, TICK_FRESCURA_MS)

    return () => {
      generacionRef.current += 1
      limpiarTimer()
      clearInterval(tick)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [rangoHoras, poll, refrescarRecursos, activo])

  return estado
}
