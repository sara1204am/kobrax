/**
 * Miembros del tenant, roles e invitación (módulo CUENTA · S2). Thin sobre
 * `apiQuery`/`apiMutate`, salvo los dos endpoints de invitación, que son **públicos** y
 * van por `publicCall` — quien acepta una invitación todavía no tiene sesión.
 *
 * El servidor manda `roleName` crudo; la etiqueta sale de `ROLE_LABEL` de shared.
 */
import { publicCall, type PublicResult } from './api';
import { apiMutate, apiQuery, type MutateResult, type QueryResult } from './api-client';

export interface Member {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  photoUrl: string | null;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  isActive: boolean;
  /** `PENDING` = invitado que todavía no aceptó (S2-D2). */
  userStatus: string;
}

/** El alta devuelve además el código, una sola vez, para poder compartirlo (S2-D9). */
export type InvitedMember = Member & { invitationCode: string };

export interface Role {
  id: string;
  name: string;
  level: number;
}

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

/** Nombre para pintar: el correo es el respaldo si el perfil viniera vacío. */
export function memberName(m: Pick<Member, 'firstName' | 'lastName' | 'email'>): string {
  const full = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim();
  return full || m.email;
}
