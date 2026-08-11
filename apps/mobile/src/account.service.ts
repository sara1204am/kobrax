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

// Las cuatro formas del contrato viven en `@kobrax/shared` (F9 · W2): son las mismas que
// edita la web. Se re-exportan para no tocar a quien ya las importaba de este archivo.
export type { AccountInfo, AccountPatch, MyProfile, ProfilePatch } from '@kobrax/shared';
import type { AccountInfo, AccountPatch, MyProfile, ProfilePatch } from '@kobrax/shared';

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
