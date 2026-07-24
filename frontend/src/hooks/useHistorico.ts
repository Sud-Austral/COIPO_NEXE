/**
 * Modo histórico (CLAUDE.md §11 Fase 2-7): consulta única a /get por un rango
 * libre [desde, hasta], SIN polling. Pagina por dataCtrTime igual que el modo
 * vivo (límite real 1000, filtro estrictamente `>`), y filtra por posTime al
 * rango pedido — los "históricos rezagados" con posTime fuera del rango se
 * descartan. La frescura/staleness se calcula respecto de `hasta`.
 */
import { useCallback, useRef, useState } from 'react'
import { buildGetBody } from '../api/contract'
import { postNexe } from '../api/client'
import { parsePositions } from '../api/parse'
import { buildFleet, maxDataCtrTime, mergePositions, type FleetStore } from '../domain/fleet'
import type { FleetResource } from '../domain/types'

const UMBRAL_PAGINA_LLENA = 900
export const MAX_PAGINAS_HISTORICO = 30 // ~30.000 posiciones; suficiente y acotado
const MARGEN_REZAGADOS_MS = 25 * 60_000 // llegadas tardías después del fin del rango

export type FaseHistorico = 'inactivo' | 'cargando' | 'ok' | 'vacio' | 'error'

export interface EstadoHistorico {
  fase: FaseHistorico
  fleet: FleetResource[]
  desdeIso: string | null
  hastaIso: string | null
  posiciones: number
  paginasCargadas: number
  truncado: boolean
}

const ESTADO_INICIAL: EstadoHistorico = {
  fase: 'inactivo',
  fleet: [],
  desdeIso: null,
  hastaIso: null,
  posiciones: 0,
  paginasCargadas: 0,
  truncado: false,
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
    const desdeMs = Date.parse(desdeIso)
    const hastaMs = Date.parse(hastaIso)

    setEstado({
      ...ESTADO_INICIAL,
      fase: 'cargando',
      desdeIso,
      hastaIso,
    })

    let store: FleetStore = new Map()
    let cursor = desdeIso
    let paginas = 0
    let acumuladas = 0
    let truncado = false

    try {
      while (paginas < MAX_PAGINAS_HISTORICO) {
        const cruda = await postNexe('get', buildGetBody(cursor))
        if (generacion !== generacionRef.current) return
        const { posiciones } = parsePositions(cruda)
        paginas += 1

        const enRango = posiciones.filter((p) => {
          const t = Date.parse(p.posTime)
          return t >= desdeMs && t <= hastaMs
        })
        if (enRango.length > 0) {
          const resultado = mergePositions(store, enRango, { limitarVentana: false })
          store = resultado.store
          acumuladas += resultado.agregadas
        }

        // avanzar el cursor; sin avance posible → fin
        const candidato = maxDataCtrTime(posiciones)
        if (candidato === null || Date.parse(candidato) <= Date.parse(cursor)) break
        cursor = candidato

        // página corta = no hay más datos; o ya pasamos el fin del rango
        if (posiciones.length < UMBRAL_PAGINA_LLENA) break
        if (Date.parse(cursor) > hastaMs + MARGEN_REZAGADOS_MS) break
      }
      truncado = paginas >= MAX_PAGINAS_HISTORICO

      if (generacion !== generacionRef.current) return
      setEstado({
        fase: acumuladas === 0 ? 'vacio' : 'ok',
        fleet: buildFleet(store, hastaMs), // staleness relativo al FIN del rango
        desdeIso,
        hastaIso,
        posiciones: acumuladas,
        paginasCargadas: paginas,
        truncado,
      })
    } catch {
      if (generacion !== generacionRef.current) return
      setEstado((previo) => ({ ...previo, fase: 'error' }))
    }
  }, [])

  return { estado, consultar, limpiar }
}
