/**
 * Lo que el servidor manda en un push remoto y a dónde lleva al tocarlo. **Funciones puras**: se prueban sin el SDK.
 *
 * 🔴 El push NO es fuente de verdad. Trae solo el tipo y ids opacos; al tocarlo se navega y la pantalla destino pide el
 * detalle a la API con la sesión abierta. Y se descarta si `uid` no es el usuario de esta sesión: un teléfono que cambió de
 * persona no puede mostrarle a la nueva un aviso de la anterior.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los tipos que salen por push (espejo de la lista cerrada del servidor: `PushService`). */
export const PUSH_TYPES = [
  'ROUTE_ASSIGNED',
  'ROUTE_CHANGE_REQUESTED',
  'ROUTE_CHANGE_DECIDED',
  'AGENDA_ASSIGNED',
  'AGENDA_CHANGED',
  'PROMISE_DUE',
] as const;
export type PushType = (typeof PUSH_TYPES)[number];

export interface PushData {
  type: PushType;
  /** Id de la notificación (también el `tag` del aviso en el teléfono). */
  nid: string;
  /** De quién es el aviso. */
  uid: string;
  rid?: string;
  aid?: string;
  cid?: string;
}

const idOrUndefined = (v: unknown): string | undefined => (typeof v === 'string' && UUID.test(v) ? v : undefined);

/** El `data` de una notificación, validado. `null` si no es un push de Kobrax (o viene mal formado). */
export function readPushData(raw: unknown): PushData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const type = (PUSH_TYPES as readonly string[]).includes(String(d.type)) ? (d.type as PushType) : null;
  const uid = idOrUndefined(d.uid);
  const nid = idOrUndefined(d.nid);
  if (!type || !uid || !nid) return null;
  return { type, nid, uid, rid: idOrUndefined(d.rid), aid: idOrUndefined(d.aid), cid: idOrUndefined(d.cid) };
}

/** ¿Este aviso es para quien tiene la sesión abierta? Sin sesión, no. */
export function isForUser(data: PushData, userId: string | null | undefined): boolean {
  return !!userId && data.uid === userId;
}

/**
 * A qué pantalla lleva. Siempre una ruta **interna y construida acá** con ids ya validados como UUID: nada del push se
 * interpola sin validar.
 */
export function pushTarget(data: PushData): string {
  switch (data.type) {
    case 'AGENDA_ASSIGNED':
    case 'AGENDA_CHANGED':
      return data.aid ? `/agenda/${data.aid}` : '/(tabs)/agenda';
    case 'PROMISE_DUE':
      return data.cid ? `/mora/${data.cid}` : '/(tabs)/cobranza';
    case 'ROUTE_ASSIGNED':
    case 'ROUTE_CHANGE_REQUESTED':
    case 'ROUTE_CHANGE_DECIDED':
    default:
      return '/(tabs)/rutas';
  }
}
