/**
 * Toasts de alerta sobre el mapa (CLAUDE.md §11 Fase 2-10): recurso que pasa
 * a "sin señal" o que recupera señal. Estado con color + ícono + texto (§10.3).
 */
import { Wifi, WifiOff, X } from 'lucide-react'
import type { Alerta } from '../../domain/alertas'
import { horaChile, utcCrudo } from '../../lib/format'
import { STRINGS } from '../../ui/strings'
import styles from './Alertas.module.css'

interface Props {
  alertas: Alerta[]
  onDescartar: (id: string) => void
  onSeleccionar: (esn: string) => void
}

export function Alertas({ alertas, onDescartar, onSeleccionar }: Props) {
  if (alertas.length === 0) return null

  return (
    <div className={styles.pila} role="region" aria-label={STRINGS.alertas.tituloRegion}>
      {alertas.map((alerta) => {
        const esCorte = alerta.tipo === 'sin-senal'
        return (
          <div
            key={alerta.id}
            className={esCorte ? `${styles.toast} ${styles.corte}` : `${styles.toast} ${styles.recupero}`}
            role={esCorte ? 'alert' : 'status'}
          >
            {esCorte ? (
              <WifiOff size={16} strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <Wifi size={16} strokeWidth={2.25} aria-hidden="true" />
            )}
            <button
              type="button"
              className={styles.mensaje}
              onClick={() => onSeleccionar(alerta.esn)}
              title={STRINGS.fleetPanel.centrarEn(alerta.label)}
            >
              {esCorte
                ? STRINGS.alertas.sinSenal(alerta.label)
                : STRINGS.alertas.recuperado(alerta.label)}
              <span
                className={styles.hora}
                title={utcCrudo(new Date(alerta.timestampMs).toISOString())}
              >
                {horaChile(new Date(alerta.timestampMs).toISOString())}
              </span>
            </button>
            <button
              type="button"
              className={styles.cerrar}
              onClick={() => onDescartar(alerta.id)}
              aria-label={STRINGS.alertas.cerrar}
            >
              <X size={14} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
