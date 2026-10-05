/**
 * Central de Mora del cobrador (`GET /api/mora`). Thin sobre `apiQuery`, con respaldo local como el resto
 * de las lecturas: sin señal la lista sale de la base y la pantalla dice de qué hora son los datos.
 *
 * Los tipos del contrato viven en `@kobrax/shared`; acá no se redefine ninguno.
 */
import type {
  ArrearCategory,
  CreditNote,
  MoraCreditDetail,
  MoraCreditListItem,
  MoraEpisode,
  MoraPromise,
  NewCreditNote,
  RecoveryActivityInput,
  RecoveryMetrics,
  UpdateCreditNote,
} from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import * as db from './db';
import { cachedList, cachedOne } from './sync/cached';
import { toMoraRows, type MoraRow } from './mora';

export interface ListMoraParams {
  limit?: number;
}

/**
 * Los créditos en mora del cobrador. El servidor acota por alcance (el cobrador ve sólo lo suyo) y pone
 * el piso de `días >= 1`: el teléfono no filtra «lo mío» ni decide qué es mora.
 *
 * La query ES la clave del respaldo: `hydrate` tiene que llamar con los mismos
 * parámetros que la pantalla o llena una casilla que nadie consulta.
 */
export function listMora(params: ListMoraParams = {}): Promise<QueryResult<MoraRow[]>> {
  const query = toQuery({ limit: params.limit });
  return cachedList<MoraRow>('mora', query || 'all', async () => {
    const res = await apiQuery<MoraCreditListItem[]>(`/mora${query}`);
    return res.status === 'ok' ? { ...res, data: toMoraRows(res.data) } : res;
  });
}

/** El tope del API por página de `GET /mora`. */
export const PORTFOLIO_PAGE_SIZE = 100;
/** Techo de páginas que se piden de una vez (2.000 créditos): una cartera mayor se corta acá en vez de colgar la pantalla. */
const PORTFOLIO_MAX_PAGES = 20;

/**
 * La cartera del cobrador: **todos** sus créditos —al día o en mora, de Kobrax o PSF, incluidos aquellos donde es
 * reemplazo temporal o apoyo (el servidor ya acota por alcance)—, de `GET /mora?todos=true`. Reemplaza al viejo
 * listado de casos. El servidor limita la página a 100: se pide página a página hasta cubrir el `total` y se
 * guarda junto bajo UNA clave de respaldo, para que sin señal la cartera salga entera.
 *
 * `hydrate`, Cobranza, Rutas y Home llaman a esta misma función: es lo que mantiene una sola casilla de caché.
 */
export function listPortfolio(): Promise<QueryResult<MoraRow[]>> {
  return cachedList<MoraRow>('portfolio', 'todos', async () => {
    const rows: MoraCreditListItem[] = [];
    let total = 0;
    for (let page = 1; page <= PORTFOLIO_MAX_PAGES; page++) {
      const res = await apiQuery<MoraCreditListItem[]>(`/mora${toQuery({ todos: true, limit: PORTFOLIO_PAGE_SIZE, page })}`);
      if (res.status !== 'ok') return res; // una página que falla no deja una cartera a medias en el respaldo
      rows.push(...res.data);
      total = res.total;
      if (rows.length >= total || res.data.length === 0) break;
    }
    return { status: 'ok', data: toMoraRows(rows), total };
  });
}

/** Cuántas filas pide el Home para saber la moneda del tenant (y el contador de créditos en mora): sólo interesa una. */
export const TENANT_CURRENCY_PROBE_LIMIT = 1;

/**
 * La moneda en la que cobra este tenant (`payments` no la trae y `GET /accounts/me` es 403 para el cobrador): la
 * del primer crédito en mora y, si nadie está en mora, la de la cartera guardada. `BOB` si no hay nada.
 */
export async function tenantCurrency(): Promise<string> {
  const mora = await listMora({ limit: TENANT_CURRENCY_PROBE_LIMIT });
  const fromMora = mora.status === 'ok' ? mora.data[0]?.currency : undefined;
  if (fromMora) return fromMora;
  try {
    return (await db.getMany<MoraRow>('portfolio'))[0]?.currency ?? 'BOB';
  } catch {
    return 'BOB';
  }
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
 * Gestión con resultado y promesa, sobre cualquier crédito del cobrador (al día o en mora). **Lleva `id` del
 * teléfono**: el servidor la guarda con ese id y un reintento (la cola) devuelve lo ya guardado en vez de crear
 * otra. No abre ningún caso; `episodeId` es el episodio de mora vigente (ausente = acción preventiva).
 */
export function addMoraActivity(
  creditId: string,
  input: RecoveryActivityInput,
): Promise<MutateResult<{ id: string; type: string; createdAt: string; episodeId?: string }>> {
  return apiMutate(`/mora/${creditId}/activities`, 'POST', input);
}

/** Nota del crédito. Idempotente por `id` (puesto por el teléfono). */
export function addMoraNote(creditId: string, input: NewCreditNote): Promise<MutateResult<CreditNote>> {
  return apiMutate(`/mora/${creditId}/notes`, 'POST', input);
}

/** El historial de mora del crédito (más reciente primero), con respaldo local. */
export function listMoraEpisodes(creditId: string): Promise<QueryResult<MoraEpisode[]>> {
  return cachedList<MoraEpisode>('mora.episodes', creditId, () => apiQuery<MoraEpisode[]>(`/mora/${creditId}/episodes`));
}

/** Las métricas de recuperación (sobre la mora actual) que calcula el servidor con `computeRecoveryMetrics`. */
export function getMoraMetrics(creditId: string): Promise<QueryResult<RecoveryMetrics>> {
  return cachedOne<RecoveryMetrics>('mora.metrics', creditId, () => apiQuery<RecoveryMetrics>(`/mora/${creditId}/metrics`));
}

/** Los rangos de categoría de mora de la cuenta: sólo para ofrecer el filtro (la categoría de cada crédito la manda la API). */
export function listArrearCategories(): Promise<QueryResult<ArrearCategory[]>> {
  return cachedList<ArrearCategory>('arrear.categories', 'all', () => apiQuery<ArrearCategory[]>('/arrear-categories'));
}

/**
 * Editar una nota. **Sólo en línea**: el texto y el tipo son de quien la escribió o de quien reparte cartera y el
 * servidor lo vuelve a exigir; encolar un cambio que luego se rechaza dejaría al cobrador creyendo que quedó.
 */
export function updateMoraNote(creditId: string, noteId: string, patch: UpdateCreditNote): Promise<MutateResult<CreditNote>> {
  return apiMutate(`/mora/${creditId}/notes/${noteId}`, 'PATCH', patch);
}

/** Borrar una nota (borrado lógico). Sólo en línea: repetirlo tras un borrado ya hecho daría 404, no es seguro de reintentar. */
export function deleteMoraNote(creditId: string, noteId: string): Promise<MutateResult<null>> {
  return apiMutate(`/mora/${creditId}/notes/${noteId}`, 'DELETE');
}
