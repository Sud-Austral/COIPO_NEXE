/**
 * Salud de la ingesta (`GET /api/estado-ingesta`, CLAUDE.md §8.5).
 *
 * Existe para distinguir dos cosas que en el visor se ven IDÉNTICAS: "la flota
 * está quieta" (datos frescos, nadie volando) y "nadie está trayendo datos"
 * (key rotada, Nexe caído, collector muerto). Sin esto, `/api/posiciones/
 * incremental` responde 200 con una colección vacía, la StatusBar dice
 * "Conectado" y el mapa sale en blanco sin que nada avise.
 *
 * Cadencia propia y lenta: el collector corre una vez por minuto, así que
 * preguntar más seguido no aporta nada. Un fallo aquí NUNCA tumba el visor —
 * se conserva el último valor conocido y se reintenta al siguiente ciclo.
 */
import { useEffect, useState } from 'react'
import { getApi } from '../api/client'

export interface EstadoIngesta {
  ingestaDetenida: boolean
  minutosDesdeUltimaCorridaOk: number | null
  /** Clase de la excepción, nunca el mensaje crudo (no filtra la api-key). */
  ultimoErrorClase: string | null
}

export const INTERVALO_INGESTA_MS = 60_000

/** Parser tolerante: si el contrato cambia, se degrada a null, no revienta. */
function leer(cuerpo: unknown): EstadoIngesta | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const c = cuerpo as Record<string, unknown>
  if (typeof c.ingestaDetenida !== 'boolean') return null
  return {
    ingestaDetenida: c.ingestaDetenida,
    minutosDesdeUltimaCorridaOk:
      typeof c.minutosDesdeUltimaCorridaOk === 'number'
        ? c.minutosDesdeUltimaCorridaOk
        : null,
    ultimoErrorClase: typeof c.ultimoErrorClase === 'string' ? c.ultimoErrorClase : null,
  }
}

export function useEstadoIngesta(intervaloMs = INTERVALO_INGESTA_MS): EstadoIngesta | null {
  const [estado, setEstado] = useState<EstadoIngesta | null>(null)

  useEffect(() => {
    let vivo = true

    const consultar = async () => {
      try {
        const cuerpo = await getApi('estado-ingesta')
        if (vivo) setEstado(leer(cuerpo))
      } catch {
        // Silencio deliberado: la salud de la ingesta es un extra informativo.
        // Si no se puede leer, se mantiene lo último conocido.
      }
    }

    void consultar()
    const id = setInterval(() => void consultar(), intervaloMs)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [intervaloMs])

  return estado
}
