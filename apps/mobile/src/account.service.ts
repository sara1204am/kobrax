/**
 * Cuenta y perfil propio (módulo CUENTA · S1). Thin sobre `apiQuery`/`apiMutate`.
 *
 * ⚠️ Los `PATCH` mandan **sólo lo que cambió**. La API corre con
 * `forbidNonWhitelisted: true`: reenviar el objeto que devolvió el `GET`
 * (que trae `planCode`, `limits`, `usage`…) es un **400**, no un no-op.
 * El payload lo arma `account-form.ts`.
 */
import { publicCall, type PublicResult } from './api';
import { apiMutate, apiQuery, type MutateResult, type QueryResult } from './api-client';
import { cachedOne } from './sync/cached';
import { setMoneyDecimals } from './agenda-form';

// Las cuatro formas del contrato viven en `@kobrax/shared` (F9 · W2): son las mismas que
// edita la web. Se re-exportan para no tocar a quien ya las importaba de este archivo.
export type { AccountInfo, AccountPatch, MyProfile, ProfilePatch } from '@kobrax/shared';
import type { AccountInfo, AccountPatch, MyProfile, ProfilePatch, SignupPlan } from '@kobrax/shared';

export interface SignupPayload {
  businessName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  /**
   * El plan elegido en las tarjetas. Ausente = FREE. Un plan pago **no se cobra acá**: la cuenta
   * nace en prueba por 30 días y al vencer cae a FREE. La lista de lo que se puede elegir la
   * decide el servidor (`SIGNUP_PLANS`), no esta pantalla.
   */
  planCode?: SignupPlan;
}

export type SignupResult = PublicResult<{ accountId: string }>;

/**
 * Registro público (S4). No devuelve tokens (S4-D1): la pantalla hace
 * `authService.login()` a continuación.
 */
export function signup(payload: SignupPayload): Promise<SignupResult> {
  return publicCall('/accounts', { method: 'POST', body: payload }, 'No se pudo crear la cuenta');
}

/**
 * La cuenta, con respaldo local.
 *
 * Se cachea por los **topes**: el aviso de «tu plan está lleno» tiene que llegarle al cobrador
 * parado frente al deudor, y ahí casi nunca hay señal. Con la copia local, la pantalla avisa
 * igual; sin ella, el aviso sólo aparecería con internet, que es justo cuando no hace falta.
 */
export async function getAccount(): Promise<QueryResult<AccountInfo>> {
  const res = await cachedOne('account', 'me', () => apiQuery<AccountInfo>('/accounts/me'));
  // La preferencia de decimales se siembra acá, el único lugar por donde la cuenta entra al
  // teléfono (de la red o de la copia local): todos los `money()` de la app la respetan.
  if (res.status === 'ok') setMoneyDecimals(res.data.currencyDecimals ?? 2);
  return res;
}

/**
 * ¿Entra uno más de este tope? `true` cuando no se sabe: **la duda no frena al cobrador**. El
 * freno de verdad lo pone el servidor; esto es para avisar donde alguien todavía puede decidir.
 */
export async function hayLugar(kind: 'credits' | 'clients'): Promise<boolean> {
  const res = await getAccount();
  if (res.status !== 'ok') return true;
  const max = res.data.limits[kind];
  return max === null || res.data.usage[kind] < max;
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
