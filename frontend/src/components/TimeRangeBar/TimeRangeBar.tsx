/**
 * Barra inferior de rango temporal. MVP: presets de rango para la carga
 * inicial del polling; el modo histórico con rango libre es Fase 2
 * (CLAUDE.md §11).
 */
import { Clock } from 'lucide-react'
import { STRINGS } from '../../ui/strings'
import styles from './TimeRangeBar.module.css'

const PRESETS: Array<{ horas: number; etiqueta: string }> = [
  { horas: 2, etiqueta: STRINGS.rango.ultimas2h },
  { horas: 6, etiqueta: STRINGS.rango.ultimas6h },
]

interface Props {
  rangoHoras: number
  onCambiarRango: (horas: number) => void
}

export function TimeRangeBar({ rangoHoras, onCambiarRango }: Props) {
  return (
    <footer className={styles.barra} role="group" aria-label={STRINGS.rango.titulo}>
      <span className={styles.titulo}>
        <Clock size={15} strokeWidth={2.25} aria-hidden="true" />
        {STRINGS.rango.titulo}
      </span>
      <span className={styles.grupo}>
        {PRESETS.map((preset) => (
          <button
            key={preset.horas}
            type="button"
            className={styles.preset}
            aria-pressed={rangoHoras === preset.horas}
            onClick={() => onCambiarRango(preset.horas)}
          >
            {preset.etiqueta}
          </button>
        ))}
      </span>
      <span className={styles.nota}>{STRINGS.rango.historicoProximamente}</span>
    </footer>
  )
}
