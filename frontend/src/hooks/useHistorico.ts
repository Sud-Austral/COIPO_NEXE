/**
 * Modo histórico (CLAUDE.md §11 Fase 2-7): una sola consulta a NUESTRO backend
 * por un rango libre, SIN polling.
 *
 * Antes esto paginaba Nexe hasta 30 veces desde el navegador y filtraba por
 * posTime en el cliente. Ahora el backend resuelve el rango con una consulta SQL
 * indexada, así que aquí solo queda pedir y pintar. La frescura se calcula
 * respecto del FIN del rango (qué recursos estaban activos en ese momento).
 */
import { useCallback, useRef, useState } from 'react'
import { getApi } from '../api/client'
import { parsePositions } from '../api/parse'
import { buildFleet, mergePositions, type FleetStore } from '../domain/fleet'
import type { FleetResource } from '../domain/types'

/** Tope del backend para /api/posiciones; si se alcanza, la respuesta viene truncada. */
export const LIMITE_HISTORICO = 20000

export type FaseHistorico = 'inactivo' | 'cargando' | 'ok' | 'vacio' | 'error'

export interface EstadoHistorico {
  fase: FaseHistorico
  fleet: FleetResource[]
  desdeIso: string | null
  hastaIso: string | null
  posiciones: number
  truncado: boolean
}

const ESTADO_INICIAL: EstadoHistorico = {
  fase: 'inactivo',
  fleet: [],
  desdeIso: null,
  hastaIso: null,
  posiciones: 0,
  truncado: false,
}

function vieneTruncado(cruda: unknown): boolean {
  return (
    typeof cruda === 'object' &&
    cruda !== null &&
    (cruda as Record<string, unknown>).truncado === true
  )
}

export function useHistorico() {
  const [estado, setEstado] = useState<EstadoHistorico>(ESTADO_INICIAL)
  const generacionRef = useRef(0)

  const limpiar = useCallback(() => {
    generacionRef.current += 1
    setEstado(ESTADO_INICIAL)
  }, [])

  const consultar = useCallback(async (desdeIso: string, hastaIso: string) => {
    generacionRef.current += 1
    const generacion = generacionRef.current

    setEstado({ ...ESTADO_INICIAL, fase: 'cargando', desdeIso, hastaIso })

    try {
      const cruda = await getApi('posiciones', {
        desde: desdeIso,
        hasta: hastaIso,
        limite: LIMITE_HISTORICO,
      })
      if (generacion !== generacionRef.current) return
      const { posiciones } = parsePositions(cruda)

      let store: FleetStore = new Map()
      if (posiciones.length > 0) {
        // Sin la ventana de 6 h del modo vivo: el rango lo fija el usuario.
        store = mergePositions(store, posiciones, { limitarVentana: false }).store
      }

      setEstado({
        fase: posiciones.length === 0 ? 'vacio' : 'ok',
        fleet: buildFleet(store, Date.parse(hastaIso)),
        desdeIso,
        hastaIso,
        posiciones: posiciones.length,
        truncado: vieneTruncado(cruda),
      })
    } catch {
      if (generacion !== generacionRef.current) return
      setEstado((previo) => ({ ...previo, fase: 'error' }))
    }
  }, [])

  return { estado, consultar, limpiar }
}
