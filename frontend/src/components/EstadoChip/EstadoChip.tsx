/**
 * Chip de estado: color + ícono + texto, siempre juntos (regla §10.3 —
 * el estado nunca se comunica solo por color).
 */
import type { FleetResource } from '../../domain/types'
import { COLOR_ESTADO, ICONO_ESTADO, TEXTO_ESTADO, estadoVisual } from '../../ui/estadoVisual'
import styles from './EstadoChip.module.css'

interface Props {
  recurso: FleetResource
  compacto?: boolean
}

export function EstadoChip({ recurso, compacto = false }: Props) {
  const estado = estadoVisual(recurso)
  const Icono = ICONO_ESTADO[estado]
  return (
    <span
      className={compacto ? `${styles.chip} ${styles.compacto}` : styles.chip}
      style={{ color: COLOR_ESTADO[estado] }}
    >
      <Icono size={compacto ? 13 : 15} strokeWidth={2.25} aria-hidden="true" />
      <span>{TEXTO_ESTADO[estado]}</span>
    </span>
  )
}
