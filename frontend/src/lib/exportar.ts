/**
 * Export de lo visible (CLAUDE.md §11 Fase 2-8): GeoJSON (FeatureCollection
 * de Points con todas las propiedades) y CSV — compatibles con QGIS y
 * kepler.gl. Exporta todas las posiciones del buffer actual (trails + última
 * posición de cada recurso), en modo vivo o histórico.
 */
import type { FleetResource, NexePosition } from '../domain/types'

/** Posiciones únicas de un recurso: trail (fixes válidos) + last si no está. */
function posicionesDeRecurso(recurso: FleetResource): NexePosition[] {
  const todas = [...recurso.trail]
  if (!todas.some((p) => p.posTime === recurso.last.posTime)) {
    todas.push(recurso.last)
  }
  return todas
}

function propiedades(recurso: FleetResource, p: NexePosition): Record<string, unknown> {
  return {
    esn: p.esn,
    label: recurso.label,
    posTime: p.posTime,
    dataCtrTime: p.dataCtrTime,
    altitude: p.altitude ?? null,
    speed: p.speed ?? null,
    heading: p.heading ?? null,
    fixType: p.fixType ?? null,
    src: p.src ?? null,
    pdop: p.pdop ?? null,
    hdop: p.hdop ?? null,
    unitId: p.unitId ?? null,
    hgExtName: p.hgExtName ?? null,
    hgAlias: p.hgAlias ?? null,
    hgAsset: p.hgAsset ?? null,
    hgAssetModel: p.hgAssetModel ?? null,
    hgAssetFamily: p.hgAssetFamily ?? null,
    hgFamilyType: p.hgFamilyType ?? null,
    hgCompany: p.hgCompany ?? null,
    hgSource: p.hgSource ?? null,
    hgNavstate: p.hgNavstate ?? null,
  }
}

/** FeatureCollection de Points — coordenadas GeoJSON [lon, lat]. */
export function aGeoJSON(recursos: FleetResource[]): string {
  const features = recursos.flatMap((recurso) =>
    posicionesDeRecurso(recurso).map((p) => ({
      type: 'Feature' as const,
      properties: propiedades(recurso, p),
      geometry: {
        type: 'Point' as const,
        coordinates: [p.longitude, p.latitude],
      },
    })),
  )
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
}

const COLUMNAS = [
  'esn',
  'label',
  'posTime',
  'dataCtrTime',
  'latitude',
  'longitude',
  'altitude',
  'speed',
  'heading',
  'fixType',
  'src',
  'pdop',
  'hdop',
  'unitId',
  'hgExtName',
  'hgAlias',
  'hgAsset',
  'hgAssetModel',
  'hgAssetFamily',
  'hgFamilyType',
  'hgCompany',
  'hgNavstate',
  'hgSource',
] as const

/** Escape RFC 4180: comillas dobles y campos con coma/salto/comilla. */
function celda(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  const texto = String(valor)
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function aCSV(recursos: FleetResource[]): string {
  const filas: string[] = [COLUMNAS.join(',')]
  for (const recurso of recursos) {
    for (const p of posicionesDeRecurso(recurso)) {
      const fuente: Record<string, unknown> = {
        ...propiedades(recurso, p),
        latitude: p.latitude,
        longitude: p.longitude,
      }
      filas.push(COLUMNAS.map((col) => celda(fuente[col])).join(','))
    }
  }
  return filas.join('\r\n')
}

/** Dispara la descarga en el navegador. El BOM ayuda a Excel con UTF-8. */
export function descargar(nombre: string, contenido: string, mime: string): void {
  const blob = new Blob(['﻿', contenido], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}

/** visor-conaf_20260708-1425_historico.geojson */
export function nombreArchivo(extension: 'geojson' | 'csv', historico: boolean): string {
  const ahora = new Date()
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  const marca = `${ahora.getFullYear()}${dosDigitos(ahora.getMonth() + 1)}${dosDigitos(ahora.getDate())}-${dosDigitos(ahora.getHours())}${dosDigitos(ahora.getMinutes())}`
  return `visor-conaf_${marca}${historico ? '_historico' : ''}.${extension}`
}
