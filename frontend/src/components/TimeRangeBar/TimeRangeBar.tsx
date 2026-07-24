/**
 * Barra inferior (CLAUDE.md §10.2 y §11): presets del modo vivo, rango libre
 * del modo histórico (Fase 2-7) y export de lo visible (Fase 2-8).
 * Las fechas se capturan en hora local (Chile) y viajan a la API en UTC.
 */
import { useState } from 'react'
import { Clock, Download, Radio } from 'lucide-react'
import { STRINGS } from '../../ui/strings'
import styles from './TimeRangeBar.module.css'

const PRESETS: Array<{ horas: number; etiqueta: string }> = [
  { horas: 2, etiqueta: STRINGS.rango.ultimas2h },
  { horas: 6, etiqueta: STRINGS.rango.ultimas6h },
]

/** Date → valor de <input type="datetime-local"> en hora local. */
function comoLocal(fecha: Date): string {
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}T${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`
}

interface Props {
  modo: 'vivo' | 'historico'
  rangoHoras: number
  consultando: boolean
  exportarDeshabilitado: boolean
  onCambiarRango: (horas: number) => void
  onConsultarHistorico: (desdeIso: string, hastaIso: string) => void
  onVolverEnVivo: () => void
  onExportar: (formato: 'geojson' | 'csv') => void
}

export function TimeRangeBar({
  modo,
  rangoHoras,
  consultando,
  exportarDeshabilitado,
  onCambiarRango,
  onConsultarHistorico,
  onVolverEnVivo,
  onExportar,
}: Props) {
  const [desde, setDesde] = useState(() => comoLocal(new Date(Date.now() - 6 * 3600_000)))
  const [hasta, setHasta] = useState(() => comoLocal(new Date()))

  const rangoValido = Date.parse(desde) < Date.parse(hasta)

  const consultar = () => {
    if (!rangoValido || consultando) return
    onConsultarHistorico(new Date(desde).toISOString(), new Date(hasta).toISOString())
  }

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
            aria-pressed={modo === 'vivo' && rangoHoras === preset.horas}
            onClick={() => onCambiarRango(preset.horas)}
          >
            {preset.etiqueta}
          </button>
        ))}
      </span>

      <span className={styles.separador} aria-hidden="true" />

      <label className={styles.campo}>
        <span className={styles.campoEtiqueta}>{STRINGS.rango.desde}</span>
        <input
          type="datetime-local"
          value={desde}
          max={hasta}
          onChange={(e) => setDesde(e.target.value)}
          aria-label={`${STRINGS.rango.desde} (${STRINGS.rango.horaLocalNota})`}
        />
      </label>
      <label className={styles.campo}>
        <span className={styles.campoEtiqueta}>{STRINGS.rango.hasta}</span>
        <input
          type="datetime-local"
          value={hasta}
          min={desde}
          onChange={(e) => setHasta(e.target.value)}
          aria-label={`${STRINGS.rango.hasta} (${STRINGS.rango.horaLocalNota})`}
        />
      </label>
      <button
        type="button"
        className={styles.consultar}
        onClick={consultar}
        disabled={!rangoValido || consultando}
        title={rangoValido ? STRINGS.rango.horaLocalNota : STRINGS.rango.rangoInvalido}
      >
        {consultando ? STRINGS.rango.consultando : STRINGS.rango.consultar}
      </button>

      {modo === 'historico' && (
        <button type="button" className={styles.volver} onClick={onVolverEnVivo}>
          <Radio size={14} strokeWidth={2.25} aria-hidden="true" />
          {STRINGS.rango.volverEnVivo}
        </button>
      )}

      <span className={styles.exportar}>
        <span className={styles.campoEtiqueta}>{STRINGS.exportar.titulo}</span>
        <button
          type="button"
          className={styles.botonExportar}
          onClick={() => onExportar('geojson')}
          disabled={exportarDeshabilitado}
          title={STRINGS.exportar.ayudaGeojson}
        >
          <Download size={14} strokeWidth={2.25} aria-hidden="true" />
          {STRINGS.exportar.geojson}
        </button>
        <button
          type="button"
          className={styles.botonExportar}
          onClick={() => onExportar('csv')}
          disabled={exportarDeshabilitado}
          title={STRINGS.exportar.ayudaCsv}
        >
          <Download size={14} strokeWidth={2.25} aria-hidden="true" />
          {STRINGS.exportar.csv}
        </button>
      </span>
    </footer>
  )
}
