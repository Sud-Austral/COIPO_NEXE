/**
 * Ciclo de polling contra el proxy (CLAUDE.md §8.3):
 *
 * 1) /get paginado — el servidor limita a ~1000 posiciones por respuesta y el
 *    filtro es estrictamente `>` sobre dataCtrTime: se repite la llamada con
 *    el cursor avanzado hasta que la tanda venga corta. El cursor NUNCA
 *    retrocede. Dedupe por (esn, posTime).
 * 2) /lastpositions — los metadatos hg* (patente, modelo, navstate…) SOLO
 *    vienen aquí; se fusionan por ESN. No mueve el cursor. Best-effort.
 *
 * Fallos: 401/422/formato desconocido detienen el polling con banner; 5xx/red
 * reintenta con backoff exponencial sin resetear el cursor. Pestaña oculta
 * pausa; al volver, poll inmediato.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildGetBody, buildLastPositionsBody } from '../api/contract'
import {
  NexeAuthError,
  NexeContractError,
  NexeUpstreamError,
  postNexe,
} from '../api/client'
import { NexeRespuestaError, parsePositions } from '../api/parse'
import { buildFleet, maxDataCtrTime, mergePositions, type FleetStore } from '../domain/fleet'
import type { FleetResource } from '../domain/types'

export const POLL_INTERVAL_MS = 30_000 // mínimo permitido por el estándar AFF
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000] // tope 60 s
const TICK_FRESCURA_MS = 5_000 // recomputar staleness aunque no lleguen datos

// paginación del /get (límite real ~1000; "tanda corta" = ya no hay más páginas)
const UMBRAL_PAGINA_LLENA = 900
const MAX_PAGINAS_POR_CICLO = 8

// lastpositions: ventana amplia hacia atrás para recuperar metadatos de toda la
// flota (14 días = almacenamiento mínimo del estándar AFF; la copia de staging
// puede quedar varios días detrás del presente)
const LOOKBACK_LASTPOS_MS = 14 * 24 * 3600_000

export type FasePolling = 'cargando' | 'ok' | 'reintentando' | 'detenido'

export interface ErrorPolling {
  tipo: 'auth' | 'contrato' | 'respuesta' | 'red'
  mensaje: string
  detalle?: unknown
}

export interface EstadoPolling {
  fase: FasePolling
  error: ErrorPolling | null
  fleet: FleetResource[]
  cursor: string | null
  ultimoPollMs: number | null
  proximoPollMs: number | null // timestamp absoluto del próximo intento
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
  const generacionRef = useRef(0) // invalida callbacks de un ciclo anterior

  const limpiarTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  /** Fusiona metadatos/última posición desde lastpositions. No mueve el cursor. */
  const refrescarLastPositions = useCallback(async () => {
    const desde = new Date(Date.now() - LOOKBACK_LASTPOS_MS).toISOString()
    const cruda = await postNexe('lastpositions', buildLastPositionsBody(desde))
    const { posiciones } = parsePositions(cruda)
    if (posiciones.length > 0) {
      storeRef.current = mergePositions(storeRef.current, posiciones).store
    }
  }, [])

  const poll = useCallback(async () => {
    const generacion = generacionRef.current
    if (detenidoRef.current || enVueloRef.current) return
    // pestaña oculta → pausar; visibilitychange reanuda con poll inmediato
    if (typeof document !== 'undefined' && document.hidden) return

    enVueloRef.current = true
    try {
      // 1) trazas: /get paginado por dataCtrTime (límite ~1000, filtro >)
      for (let pagina = 0; pagina < MAX_PAGINAS_POR_CICLO; pagina++) {
        const cruda = await postNexe('get', buildGetBody(cursorRef.current))
        if (generacion !== generacionRef.current) return
        const { posiciones } = parsePositions(cruda)

        if (posiciones.length > 0) {
          storeRef.current = mergePositions(storeRef.current, posiciones).store
          const candidato = maxDataCtrTime(posiciones)
          // el cursor NUNCA retrocede (§8.3)
          if (candidato !== null && Date.parse(candidato) > Date.parse(cursorRef.current)) {
            cursorRef.current = candidato
          } else {
            break // sin avance posible: evitar loop infinito de paginación
          }
        }
        if (posiciones.length < UMBRAL_PAGINA_LLENA) break // tanda corta: no hay más
      }

      // 2) metadatos hg* + última posición por recurso (best-effort: un fallo
      //    aquí no bota el ciclo, salvo auth/contrato que sí son fatales)
      try {
        await refrescarLastPositions()
      } catch (errorMeta) {
        if (errorMeta instanceof NexeAuthError || errorMeta instanceof NexeContractError) {
          throw errorMeta
        }
      }
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

      if (error instanceof NexeAuthError) {
        detenidoRef.current = true
        setEstado((previo) => ({
          ...previo,
          fase: 'detenido',
          proximoPollMs: null,
          error: { tipo: 'auth', mensaje: error.message, detalle: error.detalle },
        }))
        return
      }
      if (error instanceof NexeContractError) {
        detenidoRef.current = true
        setEstado((previo) => ({
          ...previo,
          fase: 'detenido',
          proximoPollMs: null,
          error: { tipo: 'contrato', mensaje: error.message, detalle: error.detalle },
        }))
        return
      }
      if (error instanceof NexeRespuestaError) {
        detenidoRef.current = true
        setEstado((previo) => ({
          ...previo,
          fase: 'detenido',
          proximoPollMs: null,
          error: { tipo: 'respuesta', mensaje: error.message, detalle: error.detalle },
        }))
        return
      }

      // 5xx / red: backoff exponencial SIN resetear el cursor (§8.3)
      const espera = BACKOFF_MS[Math.min(backoffIndiceRef.current, BACKOFF_MS.length - 1)]!
      backoffIndiceRef.current += 1
      limpiarTimer()
      timerRef.current = setTimeout(() => void poll(), espera)
      const detalle = error instanceof NexeUpstreamError ? error.detalle : undefined
      setEstado((previo) => ({
        ...previo,
        fase: 'reintentando',
        proximoPollMs: ahora + espera,
        error: {
          tipo: 'red',
          mensaje: error instanceof Error ? error.message : 'Error de red',
          detalle,
        },
      }))
    } finally {
      enVueloRef.current = false
    }
  }, [intervaloSeguro, refrescarLastPositions])

  useEffect(() => {
    generacionRef.current += 1
    if (!activo) {
      // modo histórico: sin timers, sin llamadas; al volver, recarga fresca
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

    // pintado inicial en 1 llamada (no fatal si falla); la historia la trae el primer /get
    void (async () => {
      try {
        await refrescarLastPositions()
        if (generacion !== generacionRef.current) return
        if (storeRef.current.size > 0) {
          const ahora = Date.now()
          setEstado((previo) => ({
            ...previo,
            fleet: buildFleet(storeRef.current, ahora),
          }))
        }
      } catch {
        // silencioso: el poll inmediato siguiente informa cualquier error real
      }
      if (generacion === generacionRef.current) void poll()
    })()

    const alCambiarVisibilidad = () => {
      if (!document.hidden && !detenidoRef.current) {
        limpiarTimer()
        void poll() // al volver, poll inmediato (§8.3)
      }
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)

    // tick de frescura: el staleness avanza aunque no lleguen posiciones
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
  }, [rangoHoras, poll, refrescarLastPositions, activo])

  return estado
}
