/**
 * Cliente HTTP hacia el proxy propio (/api/nexe/*). Errores tipados para que
 * usePolling decida: detenerse (401/422) o reintentar con backoff (5xx/red).
 */
import type { NexeRequest } from './contract'

export class NexeAuthError extends Error {
  constructor(public detalle: unknown) {
    super('Credenciales inválidas contra Nexe (401)')
    this.name = 'NexeAuthError'
  }
}

export class NexeContractError extends Error {
  constructor(public detalle: unknown) {
    super('El servidor Nexe rechazó el body (422): contrato desalineado')
    this.name = 'NexeContractError'
  }
}

export class NexeUpstreamError extends Error {
  constructor(
    public status: number | null,
    public detalle?: unknown,
  ) {
    super(
      status === null
        ? 'Sin conexión con el proxy'
        : `Error ${status} consultando Nexe`,
    )
    this.name = 'NexeUpstreamError'
  }
}

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/nexe'

/**
 * Modo demo (GitHub Pages): sin proxy disponible y con Nexe sin CORS, las
 * peticiones se atienden con el simulador EN el navegador — cero red, cero
 * key en el bundle (CLAUDE.md §3). Se fija en build con VITE_DEMO=1.
 */
const MODO_DEMO = import.meta.env.VITE_DEMO === '1'

export type RutaNexe = 'get' | 'lastpositions'

export async function postNexe(ruta: RutaNexe, body: NexeRequest): Promise<unknown> {
  if (MODO_DEMO) {
    const { manejarSimulacion } = await import('../demo/simuladorNexe')
    return manejarSimulacion(ruta, body)
  }

  let respuesta: Response
  try {
    respuesta = await fetch(`${API_BASE}/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new NexeUpstreamError(null)
  }

  const texto = await respuesta.text()
  let cuerpo: unknown = texto
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    // el body puede venir como texto plano (p. ej. "Internal Server Error")
  }

  if (respuesta.ok) return cuerpo
  if (respuesta.status === 401) throw new NexeAuthError(cuerpo)
  if (respuesta.status === 422) throw new NexeContractError(cuerpo)
  throw new NexeUpstreamError(respuesta.status, cuerpo)
}
