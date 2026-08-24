/**
 * Cliente HTTP hacia NUESTRO backend (`/api/*`), no hacia Nexe.
 *
 * El navegador ya no arma el body AFF ni pagina: eso lo hace el collector contra
 * Nexe, y el backend sirve desde la base propia. Aquí solo quedan GET con query
 * params y errores tipados para que los hooks decidan reintentar o detenerse.
 *
 * La respuesta mantiene la forma GeoJSON FeatureCollection con el vocabulario de
 * Nexe, así que `parse.ts` la consume sin cambios.
 */

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public detalle: unknown,
  ) {
    super(`El backend rechazó la consulta (${status})`)
    this.name = 'ApiRequestError'
  }
}

export class ApiNoDisponibleError extends Error {
  constructor(
    public status: number | null,
    public detalle?: unknown,
  ) {
    super(
      status === null
        ? 'Sin conexión con el servidor del visor'
        : `El servidor del visor respondió ${status}`,
    )
    this.name = 'ApiNoDisponibleError'
  }
}

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api'

/**
 * Modo demo (GitHub Pages): sin backend ni base de datos, las consultas se
 * atienden con el simulador EN el navegador — cero red, cero secretos en el
 * bundle (CLAUDE.md §3). Se fija en build con VITE_DEMO=1.
 */
const MODO_DEMO = import.meta.env.VITE_DEMO === '1'

export type RutaApi =
  | 'posiciones/incremental'
  | 'posiciones'
  | 'recursos'
  | 'estado-ingesta'

export type Parametros = Record<string, string | number | undefined>

export async function getApi(ruta: RutaApi, parametros: Parametros = {}): Promise<unknown> {
  if (MODO_DEMO) {
    const { manejarSimulacion } = await import('../demo/simuladorNexe')
    return manejarSimulacion(ruta, parametros)
  }

  const query = new URLSearchParams()
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== undefined) query.set(clave, String(valor))
  }
  const sufijo = query.toString() ? `?${query}` : ''

  let respuesta: Response
  try {
    respuesta = await fetch(`${API_BASE}/${ruta}${sufijo}`)
  } catch {
    throw new ApiNoDisponibleError(null)
  }

  const texto = await respuesta.text()
  let cuerpo: unknown = texto
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    // puede venir texto plano (p. ej. un error de nginx)
  }

  if (respuesta.ok) return cuerpo
  // 4xx (menos 429) es un error nuestro de programación: reintentar no ayuda.
  if (respuesta.status >= 400 && respuesta.status < 500 && respuesta.status !== 429) {
    throw new ApiRequestError(respuesta.status, cuerpo)
  }
  throw new ApiNoDisponibleError(respuesta.status, cuerpo)
}
