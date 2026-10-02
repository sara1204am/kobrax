/**
 * Central de Mora del cobrador (`GET /api/mora`). Thin sobre `apiQuery`, con respaldo local como el resto
 * de las lecturas: sin señal la lista sale de la base y la pantalla dice de qué hora son los datos.
 *
 * Los tipos del contrato viven en `@kobrax/shared`; acá no se redefine ninguno.
 */
import type { MoraCreditListItem } from '@kobrax/shared';
import { apiQuery, toQuery, type QueryResult } from './api-client';
import { cachedList } from './sync/cached';
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
