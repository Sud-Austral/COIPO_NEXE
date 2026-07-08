/**
 * Mapeo único navState + freshness → presentación (texto, ícono lucide,
 * variable de color). El estado NUNCA se comunica solo por color (§10.3):
 * quien consuma esto debe renderizar ícono + texto.
 */
import {
  CircleStop,
  HelpCircle,
  Navigation,
  RadioTower,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import type { FleetResource } from '../domain/types'
import { STRINGS } from './strings'

export type EstadoVisual = 'enruta' | 'tierra' | 'parado' | 'stale' | 'desconocido'

/** Si no hay señal reciente, eso manda por sobre el último navState conocido. */
export function estadoVisual(recurso: FleetResource): EstadoVisual {
  if (recurso.freshness === 'stale') return 'stale'
  switch (recurso.navState) {
    case 5:
      return 'enruta'
    case 4:
      return 'tierra'
    case 2:
      return 'parado'
    default:
      return 'desconocido'
  }
}

export const TEXTO_ESTADO: Record<EstadoVisual, string> = {
  enruta: STRINGS.estados.enRuta,
  tierra: STRINGS.estados.emitiendoTierra,
  parado: STRINGS.estados.parado,
  stale: STRINGS.estados.sinSenal,
  desconocido: STRINGS.estados.desconocido,
}

export const ICONO_ESTADO: Record<EstadoVisual, LucideIcon> = {
  enruta: Navigation,
  tierra: RadioTower,
  parado: CircleStop,
  stale: WifiOff,
  desconocido: HelpCircle,
}

/** Variable CSS del color de estado (tokens de §10.1). */
export const COLOR_ESTADO: Record<EstadoVisual, string> = {
  enruta: 'var(--state-enroute)',
  tierra: 'var(--state-ground)',
  parado: 'var(--state-stopped)',
  stale: 'var(--state-stale)',
  desconocido: 'var(--text-muted)',
}
