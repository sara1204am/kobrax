/**
 * Sesiones y dispositivos de la persona (U3). Sin caché a propósito: es un dato de seguridad y mostrar una lista vieja de
 * dispositivos «activos» es peor que mostrar nada. Sin señal, la pantalla lo dice.
 */
import type { SessionInfo } from '@kobrax/shared';
import { apiMutate, apiQuery, type MutateResult, type QueryResult } from './api-client';

export type { SessionInfo };

/** `GET /auth/sessions`: todas las sesiones vivas de la persona (de todas sus cuentas). */
export function listSessions(): Promise<QueryResult<SessionInfo[]>> {
  return apiQuery<SessionInfo[]>('/auth/sessions');
}

/** `DELETE /auth/sessions/:id`. Idempotente en el servidor: una ajena o ya cerrada no hace nada. */
export function revokeSession(id: string): Promise<MutateResult<null>> {
  return apiMutate<null>(`/auth/sessions/${encodeURIComponent(id)}`, 'DELETE');
}

/** `DELETE /auth/sessions`: cierra todas **menos la actual**. */
export function revokeOtherSessions(): Promise<MutateResult<null>> {
  return apiMutate<null>('/auth/sessions', 'DELETE');
}

/** «Android · Moto G» / «Navegador · Windows» — lo que se le muestra a la persona para reconocer el dispositivo. */
export function sessionTitle(s: Pick<SessionInfo, 'deviceName' | 'deviceType' | 'os'>): string {
  const kind = s.deviceType === 'mobile' ? 'Teléfono' : s.deviceType === 'web' ? 'Navegador' : 'Dispositivo';
  const detail = s.deviceName || s.os;
  return detail ? `${kind} · ${detail}` : kind;
}
