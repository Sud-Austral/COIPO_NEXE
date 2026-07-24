/**
 * Alertas visuales (CLAUDE.md §11 Fase 2-10): detección PURA de transiciones
 * de frescura entre dos instantes de la flota. Un recurso que aparece por
 * primera vez no genera alerta (no hay transición conocida).
 */
import type { FleetResource, Freshness } from './types'

export interface Alerta {
  id: string
  tipo: 'sin-senal' | 'recuperado'
  esn: string
  label: string
  timestampMs: number
}

export function detectarTransiciones(
  previas: ReadonlyMap<string, Freshness>,
  fleet: FleetResource[],
  ahoraMs: number,
): Alerta[] {
  const alertas: Alerta[] = []
  for (const recurso of fleet) {
    const anterior = previas.get(recurso.esn)
    if (anterior === undefined) continue // primera vez visto: sin transición

    if (anterior !== 'stale' && recurso.freshness === 'stale') {
      alertas.push({
        id: `${recurso.esn}|sin-senal|${ahoraMs}`,
        tipo: 'sin-senal',
        esn: recurso.esn,
        label: recurso.label,
        timestampMs: ahoraMs,
      })
    } else if (anterior === 'stale' && recurso.freshness !== 'stale') {
      alertas.push({
        id: `${recurso.esn}|recuperado|${ahoraMs}`,
        tipo: 'recuperado',
        esn: recurso.esn,
        label: recurso.label,
        timestampMs: ahoraMs,
      })
    }
  }
  return alertas
}

/** Instantánea de frescura por ESN, para comparar en el próximo ciclo. */
export function instantaneaFrescura(fleet: FleetResource[]): Map<string, Freshness> {
  return new Map(fleet.map((r) => [r.esn, r.freshness]))
}
