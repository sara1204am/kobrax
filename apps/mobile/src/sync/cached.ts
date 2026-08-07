/**
 * La capa de lectura offline. Envuelve una llamada del service y le agrega dos cosas:
 * con red **guarda** lo que trajo, y sin red **devuelve lo último guardado**.
 *
 * Va en los `*.service.ts` y no en las pantallas: las pantallas ya saben tratar `status: 'offline'`
 * desde P0 y no se tocan. Un solo lugar decide qué es leer sin señal.
 *
 * **Las listas se guardan por consulta y las fichas por entidad.** No es un capricho: una consulta
 * ("los casos abiertos de este cobrador") lleva filtros que resuelve el servidor, y replicarlos acá
 * sería duplicar reglas de negocio en el cliente — la copia se desincroniza y miente. Guardando la
 * respuesta tal cual, sin señal el cobrador ve exactamente lo que vio la última vez con señal.
 * La ficha, en cambio, es una entidad sola y se busca por id venga de la lista que venga.
 */
import type { QueryResult } from '../api-client';
import * as db from '../db';
import type { CacheKind } from '../db';

/**
 * Lista con respaldo local. `scope` identifica **la consulta** (no la entidad): dos búsquedas
 * distintas del mismo recurso son dos scopes distintos y no se pisan.
 */
export async function cachedList<T extends { id: string }>(
  kind: CacheKind,
  scope: string,
  fetcher: () => Promise<QueryResult<T[]>>,
): Promise<QueryResult<T[]>> {
  const res = await fetcher();
  if (res.status === 'ok') {
    await db.replaceAll<T>(kind, res.data, scope);
    return res;
  }
  // Sólo el "no hay red" cae al respaldo. Un error del servidor o una sesión vencida son otra
  // cosa y tienen que llegar a la pantalla tal cual: taparlos con datos viejos esconde el problema.
  if (res.status !== 'offline') return res;

  const local = await db.getMany<T>(kind, scope);
  if (local.length === 0) return res;
  return { status: 'ok', data: local, total: local.length, localAt: await db.fetchedAt(kind, scope) };
}

/**
 * Ficha con respaldo local. El id llega por parámetro y no se le exige al objeto tenerlo: los
 * detalles del API suelen ser compuestos (`{ item, client, credit, history }`), no entidades planas.
 */
export async function cachedOne<T>(
  kind: CacheKind,
  id: string,
  fetcher: () => Promise<QueryResult<T>>,
): Promise<QueryResult<T>> {
  const res = await fetcher();
  if (res.status === 'ok') {
    await db.putOne(kind, id, res.data);
    return res;
  }
  if (res.status !== 'offline') return res;

  const local = await db.getOne<T>(kind, id);
  if (!local) return res;
  return { status: 'ok', data: local, total: 1, localAt: await db.fetchedAt(kind) };
}
