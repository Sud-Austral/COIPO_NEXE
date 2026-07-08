/**
 * Ícono de aeronave para Leaflet: dardo rotado por heading cuando va en ruta,
 * punto cuando está quieta. El anillo exterior codifica la frescura (pulso en
 * "live", estático en "delayed", discontinuo rojo en "stale") — elemento firma
 * de CLAUDE.md §10.1. Los estilos viven en marcadores.css (clases globales,
 * porque el HTML del divIcon se monta fuera de React).
 */
import L from 'leaflet'
import type { FleetResource } from '../../domain/types'
import { estadoVisual } from '../../ui/estadoVisual'

export function iconoRecurso(recurso: FleetResource, seleccionado: boolean): L.DivIcon {
  const estado = estadoVisual(recurso)
  const enMovimiento = recurso.navState === 5 && recurso.last.heading !== undefined
  const rumbo = Math.round(recurso.last.heading ?? 0)

  const glifo = enMovimiento
    ? `<svg class="mk-glifo" viewBox="0 0 24 24" style="--rumbo:${rumbo}deg" aria-hidden="true"><path d="M12 2 L19 21 L12 16.6 L5 21 Z"/></svg>`
    : `<svg class="mk-glifo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5"/></svg>`

  const clases = ['mk', `mk-${estado}`, `mk-${recurso.freshness}`]
  if (seleccionado) clases.push('mk-sel')

  return L.divIcon({
    className: 'mk-envoltura',
    html: `<div class="${clases.join(' ')}"><span class="mk-anillo"></span>${glifo}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -16],
  })
}
