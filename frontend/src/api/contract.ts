/**
 * ÚNICO lugar donde se arma el body hacia Nexe (CLAUDE.md §8.1, regla §14.3).
 *
 * Refleja el ejemplo oficial de Nexe (correo de José C., 3-jul-2026). Los
 * valores "string" son placeholders literales del ejemplo que el servidor
 * acepta (PENDIENTE §2.1: probar si pueden omitirse; hasta entonces se imita
 * el ejemplo exacto). La key ya filtra los recursos de CONAF.
 *
 * Fechas SIEMPRE en ISO 8601 UTC con milisegundos y Z (toISOString()).
 */
import type { FamilyType } from '../domain/types'

export const NEXE_TYPE = 'dataRequest' as const

export interface DataCenterItem {
  affVer: string
  name: string
  reqTime: string
}

export interface MsgRequestItem {
  to: string
  from: string
  msgType: string
  /** EL filtro: posiciones llegadas al servidor DESPUÉS (>) de esta fecha. */
  dataCtrTime: string
  /**
   * Solo get_lastpositions y solo si se filtra por familia — si no, NO incluirlo.
   * CONFIRMADO que debe ser lista (422 si va string), PERO staging devuelve 500
   * con valores válidos (["ground"]/["Ground"]) — escalado a Nexe; no usar aún.
   */
  domain?: FamilyType[]
}

export interface NexeRequest {
  type: typeof NEXE_TYPE
  dataCenter: DataCenterItem[]
  msgRequest: MsgRequestItem[]
}

function dataCenterItem(): DataCenterItem {
  return { affVer: 'string', name: 'string', reqTime: new Date().toISOString() }
}

/** Listas vacías producen 500 en el servidor real (regla dura §14.2). */
function sinListasVacias(body: NexeRequest): NexeRequest {
  if (body.dataCenter.length === 0 || body.msgRequest.length === 0) {
    throw new Error(
      'contract.ts: dataCenter/msgRequest no pueden ir vacíos (el servidor Nexe responde 500)',
    )
  }
  return body
}

/** Body para POST /position/affjson/get — trazas llegadas después de `fromIsoUtc`. */
export function buildGetBody(fromIsoUtc: string): NexeRequest {
  return sinListasVacias({
    type: NEXE_TYPE,
    dataCenter: [dataCenterItem()],
    msgRequest: [{ to: 'string', from: 'string', msgType: 'string', dataCtrTime: fromIsoUtc }],
  })
}

/**
 * Body para POST /position/affjson/get_lastpositions.
 * `domain` filtra por familia (people|ground|rotary|fixed) y va como LISTA;
 * si no se filtra, el parámetro NO debe ir en la llamada (indicación de Nexe).
 * OJO: staging responde 500 al usarlo (bug escalado) — la app no lo envía.
 */
export function buildLastPositionsBody(fromIsoUtc: string, domain?: FamilyType): NexeRequest {
  const msg: MsgRequestItem = {
    to: 'string',
    from: 'string',
    msgType: 'string',
    dataCtrTime: fromIsoUtc,
  }
  if (domain !== undefined) msg.domain = [domain]
  return sinListasVacias({
    type: NEXE_TYPE,
    dataCenter: [dataCenterItem()],
    msgRequest: [msg],
  })
}
