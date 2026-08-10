/**
 * Miembros del tenant, roles e invitación (módulo CUENTA · S2). Thin sobre
 * `apiQuery`/`apiMutate`, salvo los dos endpoints de invitación, que son **públicos** y
 * van por `publicCall` — quien acepta una invitación todavía no tiene sesión.
 *
 * El servidor manda `roleName` crudo; la etiqueta sale de `ROLE_LABEL` de shared.
 */
import { publicCall, type PublicResult } from './api';
import { apiMutate, apiQuery, type MutateResult, type QueryResult } from './api-client';

// El contrato de `/users` y `/roles` y la regla del nombre visible viven en `@kobrax/shared`
// (F9 · W2): el panel web consume los mismos endpoints. Se re-exportan para no tocar a quien
// ya los importaba de este archivo.
export type { Member, InvitedMember, AssignableRole as Role } from '@kobrax/shared';
export { memberName } from '@kobrax/shared';
import type { Member, InvitedMember, AssignableRole as Role } from '@kobrax/shared';

export interface InvitePayload {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
}

export interface Invitation {
  email: string;
  firstName: string | null;
  businessName: string | null;
}

export function listMembers(): Promise<QueryResult<Member[]>> {
  return apiQuery<Member[]>('/users');
}

/** Sólo los 3 roles que el móvil administra: el recorte lo hace el servidor. */
export function listRoles(): Promise<QueryResult<Role[]>> {
  return apiQuery<Role[]>('/roles');
}

export function inviteMember(payload: InvitePayload): Promise<MutateResult<InvitedMember>> {
  return apiMutate<InvitedMember>('/users/invite', 'POST', payload);
}

export function updateMember(
  userId: string,
  patch: { roleId?: string; isActive?: boolean },
): Promise<MutateResult<Member>> {
  return apiMutate<Member>(`/users/${userId}`, 'PATCH', patch);
}

export function resendInvitation(userId: string): Promise<MutateResult<InvitedMember>> {
  return apiMutate<InvitedMember>(`/users/${userId}/invite/resend`, 'POST');
}

/** Cancelar la invitación: borra al pendiente y libera el asiento y el correo (S2-D5). */
export function removeMember(userId: string): Promise<MutateResult<null>> {
  return apiMutate<null>(`/users/${userId}`, 'DELETE');
}

// ── Públicos (sin sesión) ───────────────────────────────────────────────────
export function getInvitation(code: string): Promise<PublicResult<Invitation>> {
  return publicCall<Invitation>(
    `/auth/invitation/${encodeURIComponent(code)}`,
    {},
    'No pudimos leer la invitación',
  );
}

export function acceptInvitation(
  code: string,
  password: string,
): Promise<PublicResult<{ email: string }>> {
  return publicCall(
    '/auth/invitation/accept',
    { method: 'POST', body: { code, password } },
    'No pudimos aceptar la invitación',
  );
}

// `memberName` se mudó a `@kobrax/shared` y se re-exporta arriba.
