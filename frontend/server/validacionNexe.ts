/**
 * Validación del body AFF JSON replicando el comportamiento CONFIRMADO del
 * servidor real de Nexe (CLAUDE.md §2 y §7.2): errores 422 estilo
 * FastAPI/Pydantic v2 con `detail[].loc/type/msg`, y 500 ante listas vacías.
 *
 * Módulo puro (sin Express) para poder testearlo con Vitest (§12).
 */

export interface DetalleError {
  type: string
  loc: (string | number)[]
  msg: string
  input?: unknown
}

export type ResultadoValidacion =
  | { ok: true; dataCenter: unknown[]; msgRequest: unknown[] }
  | { ok: false; status: 422; detail: DetalleError[] }
  | { ok: false; status: 500 }

export function validarBodyNexe(body: unknown): ResultadoValidacion {
  const detail: DetalleError[] = []
  const objeto: Record<string, unknown> =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}

  for (const campo of ['type', 'dataCenter', 'msgRequest'] as const) {
    if (!(campo in objeto)) {
      detail.push({ type: 'missing', loc: ['body', campo], msg: 'Field required' })
    }
  }

  if ('type' in objeto && objeto.type !== 'dataRequest') {
    detail.push({
      type: 'literal_error',
      loc: ['body', 'type'],
      msg: "Input should be 'dataRequest'",
      input: objeto.type,
    })
  }
  for (const campo of ['dataCenter', 'msgRequest'] as const) {
    if (campo in objeto && !Array.isArray(objeto[campo])) {
      detail.push({
        type: 'list_type',
        loc: ['body', campo],
        msg: 'Input should be a valid list',
        input: objeto[campo],
      })
    }
  }

  if (detail.length > 0) return { ok: false, status: 422, detail }

  const dataCenter = objeto.dataCenter as unknown[]
  const msgRequest = objeto.msgRequest as unknown[]

  // Réplica del comportamiento real: listas vacías pasan la validación
  // Pydantic pero el handler revienta con 500 (CLAUDE.md §2).
  if (dataCenter.length === 0 || msgRequest.length === 0) {
    return { ok: false, status: 500 }
  }

  return { ok: true, dataCenter, msgRequest }
}
