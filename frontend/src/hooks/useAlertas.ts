/**
 * Observa la flota (modo vivo) y acumula alertas de transición de señal.
 * Expira automáticamente a los 60 s; también se pueden descartar a mano.
 */
import { useEffect, useRef, useState } from 'react'
import {
  detectarTransiciones,
  instantaneaFrescura,
  type Alerta,
} from '../domain/alertas'
import type { FleetResource, Freshness } from '../domain/types'

const EXPIRACION_MS = 60_000
const MAX_ALERTAS = 6

export function useAlertas(fleet: FleetResource[], habilitado: boolean) {
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const previasRef = useRef<Map<string, Freshness>>(new Map())

  useEffect(() => {
    if (!habilitado || fleet.length === 0) return
    const ahora = Date.now()
    const nuevas = detectarTransiciones(previasRef.current, fleet, ahora)
    previasRef.current = instantaneaFrescura(fleet)
    if (nuevas.length > 0) {
      setAlertas((previas) => [...nuevas, ...previas].slice(0, MAX_ALERTAS))
    }
  }, [fleet, habilitado])

  // expiración periódica
  useEffect(() => {
    const intervalo = setInterval(() => {
      const limite = Date.now() - EXPIRACION_MS
      setAlertas((previas) =>
        previas.some((a) => a.timestampMs < limite)
          ? previas.filter((a) => a.timestampMs >= limite)
          : previas,
      )
    }, 5_000)
    return () => clearInterval(intervalo)
  }, [])

  const descartar = (id: string) =>
    setAlertas((previas) => previas.filter((a) => a.id !== id))

  return { alertas, descartar }
}
