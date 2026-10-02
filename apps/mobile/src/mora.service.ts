/**
 * Central de Mora del cobrador (`GET /api/mora`). Thin sobre `apiQuery`, con respaldo local como el resto
 * de las lecturas: sin señal la lista sale de la base y la pantalla dice de qué hora son los datos.
 *
 * Los tipos del contrato viven en `@kobrax/shared`; acá no se redefine ninguno.
 */
import type { CreditNote, MoraCreditDetail, MoraCreditListItem, MoraPromise, NewCreditNote, RecoveryActivityInput } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import { cachedList, cachedOne } from './sync/cached';
import { toMoraRows, type MoraRow } from './mora';

export interface ListMoraParams {
  limit?: number;
}

/**
 * Los créditos en mora del cobrador. El servidor acota por alcance (el cobrador ve sólo lo suyo) y pone
 * el piso de `días >= 1`: el teléfono no filtra «lo mío» ni decide qué es mora.
 *
 * La query ES la clave del respaldo (igual que `listCases`): `hydrate` tiene que llamar con los mismos
 * parámetros que la pantalla o llena una casilla que nadie consulta.
 */
export function listMora(params: ListMoraParams = {}): Promise<QueryResult<MoraRow[]>> {
  const query = toQuery({ limit: params.limit });
  return cachedList<MoraRow>('mora', query || 'all', async () => {
    const res = await apiQuery<MoraCreditListItem[]>(`/mora${query}`);
    return res.status === 'ok' ? { ...res, data: toMoraRows(res.data) } : res;
  });
}

/** Cuántos créditos baja la pantalla (y la hidratación). La cartera de un cobrador cabe en memoria. */
export const MORA_LIMIT = 100;

/** La ficha de recuperación de un crédito. Con respaldo local: sin señal se abre con lo último que se bajó. */
export function getMora(creditId: string): Promise<QueryResult<MoraCreditDetail>> {
  return cachedOne<MoraCreditDetail>('mora.detail', creditId, () => apiQuery<MoraCreditDetail>(`/mora/${creditId}`));
}

/** Las promesas del crédito (más reciente primero). `scope` = el crédito, para que no se mezclen entre sí. */
export function listMoraPromises(creditId: string): Promise<QueryResult<MoraPromise[]>> {
  return cachedList<MoraPromise>('mora.promises', creditId, () => apiQuery<MoraPromise[]>(`/mora/${creditId}/promises`));
}

/** Las notas del crédito (más reciente primero). */
export function listMoraNotes(creditId: string): Promise<QueryResult<CreditNote[]>> {
  return cachedList<CreditNote>('mora.notes', creditId, () => apiQuery<CreditNote[]>(`/mora/${creditId}/notes`));
}

/**
 * Gestión con resultado y promesa. **Lleva `id` del teléfono**: el servidor lo guarda con ese id y un
 * reintento (la cola) devuelve lo ya guardado en vez de crear otra. Abre el caso si el crédito no tiene.
 */
export function addMoraActivity(
  creditId: string,
  input: RecoveryActivityInput,
): Promise<MutateResult<{ id: string; type: string; createdAt: string; caseId: string; caseOpened: boolean }>> {
  return apiMutate(`/mora/${creditId}/activities`, 'POST', input);
}

/** Nota del crédito. Idempotente por `id` (puesto por el teléfono). */
export function addMoraNote(creditId: string, input: NewCreditNote): Promise<MutateResult<CreditNote>> {
  return apiMutate(`/mora/${creditId}/notes`, 'POST', input);
}
