/**
 * Cuenta y perfil propio (módulo CUENTA · S1). Thin sobre `apiQuery`/`apiMutate`.
 *
 * ⚠️ Los `PATCH` mandan **sólo lo que cambió**. La API corre con
 * `forbidNonWhitelisted: true`: reenviar el objeto que devolvió el `GET`
 * (que trae `planCode`, `maxUsers`, `memberCount`…) es un **400**, no un no-op.
 * El payload lo arma `account-form.ts`.
 */
import { publicCall, type PublicResult } from './api';
import { apiMutate, apiQuery, type MutateResult, type QueryResult } from './api-client';

export interface AccountInfo {
  id: string;
  businessName: string;
  taxId: string | null;
  accountType: string;
  status: string;
  planCode: string;
  countryCode: string;
  currencyCode: string;
  timezone: string | null;
  maxUsers: number;
  memberCount: number;
}

/** Los 5 campos que la API acepta editar. El formulario sólo expone los primeros 4. */
export interface AccountPatch {
  businessName?: string;
  taxId?: string;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string;
}

export interface MyProfile {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  photoUrl: string | null;
}

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  phone?: string;
  photoUrl?: string;
}

export interface SignupPayload {
  businessName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export type SignupResult = PublicResult<{ accountId: string }>;

/**
 * Registro público (S4). No devuelve tokens (S4-D1): la pantalla hace
 * `authService.login()` a continuación.
 */
export function signup(payload: SignupPayload): Promise<SignupResult> {
  return publicCall('/accounts', { method: 'POST', body: payload }, 'No se pudo crear la cuenta');
}

export function getAccount(): Promise<QueryResult<AccountInfo>> {
  return apiQuery<AccountInfo>('/accounts/me');
}

export function updateAccount(patch: AccountPatch): Promise<MutateResult<AccountInfo>> {
  return apiMutate<AccountInfo>('/accounts/me', 'PATCH', patch);
}

export function getMyProfile(): Promise<QueryResult<MyProfile>> {
  return apiQuery<MyProfile>('/users/me/profile');
}

export function updateMyProfile(patch: ProfilePatch): Promise<MutateResult<MyProfile>> {
  return apiMutate<MyProfile>('/users/me/profile', 'PATCH', patch);
}
