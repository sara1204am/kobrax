import { collateralPayload, contactPayload, locationPayload, relationPayload, type ClienteOps } from '@kobrax/shared';

export interface ApiRequest {
  path: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/*
 * Acá vivía `emptyOps`, que armaba un `ClienteOps` con un solo cambio adentro para el alta suelta de
 * un teléfono o una dirección desde la ficha. Se fue con esos dos mini-formularios: ahora la sección
 * entera se edita con los mismos campos que el resto del cliente, así que todo cambio sale del
 * mismo `diffCliente` y no hay una segunda forma de armar el mismo cuerpo.
 */

/**
 * El diff del formulario → la secuencia de llamadas a la API.
 *
 * Guardar una edición **no es una llamada**: los teléfonos, direcciones y garantes son recursos
 * aparte, cada uno con su endpoint, y `UpdateClientDto` no los acepta. Esto arma la lista; quien la
 * ejecuta es el handler del BFF, así que el navegador sigue haciendo **una sola** llamada.
 *
 * El orden importa por una razón concreta: **primero lo que se borra**. Si una fila se quita y otra
 * se agrega en el mismo guardado, hacerlo al revés deja al cliente con las dos vivas un instante —
 * y si la segunda falla, con la vieja que ya se quería sacar.
 *
 * Los sub-recursos de un garante **nuevo** no aparecen acá: viajan dentro de su alta, que es
 * atómica. Los de uno que ya existía van por su propia ruta con `relationId`. Esa distinción la
 * hace `diffCliente` en `shared`, no este archivo.
 *
 * ponytail: el móvil tiene su propia versión de esta secuencia dentro de su pantalla de editar.
 * No se promovió porque allá cada llamada pasa por la cola offline y acá por el BFF: lo que se
 * comparte es el diff, que es la regla. Si el orden cambia, cambia en los dos lados.
 */
export function opsRequests(id: string, ops: ClienteOps): ApiRequest[] {
  const out: ApiRequest[] = [];
  const sub = (kind: string, rest = '') => `/clients/${id}/${kind}${rest}`;

  if (ops.client) out.push({ path: `/clients/${id}`, method: 'PATCH', body: ops.client });

  for (const rid of ops.contacts.removeIds) out.push({ path: sub('contacts', `/${rid}`), method: 'DELETE' });
  for (const rid of ops.locations.removeIds) out.push({ path: sub('locations', `/${rid}`), method: 'DELETE' });
  for (const rid of ops.relations.removeIds) out.push({ path: sub('relations', `/${rid}`), method: 'DELETE' });
  for (const rid of ops.collaterals.removeIds) out.push({ path: sub('collaterals', `/${rid}`), method: 'DELETE' });

  for (const c of ops.contacts.add) out.push({ path: sub('contacts'), method: 'POST', body: contactPayload(c) });
  for (const c of ops.contacts.update) {
    out.push({ path: sub('contacts', `/${c.serverId!}`), method: 'PATCH', body: contactPayload(c) });
  }
  for (const l of ops.locations.add) out.push({ path: sub('locations'), method: 'POST', body: locationPayload(l) });
  for (const l of ops.locations.update) {
    out.push({ path: sub('locations', `/${l.serverId!}`), method: 'PATCH', body: locationPayload(l) });
  }

  for (const r of ops.relations.add) out.push({ path: sub('relations'), method: 'POST', body: relationPayload(r) });
  for (const r of ops.relations.update) {
    // El PATCH de un garante no lleva sus sub-recursos: tienen su propia vía.
    const { contacts: _c, locations: _l, ...campos } = relationPayload(r);
    out.push({ path: sub('relations', `/${r.serverId!}`), method: 'PATCH', body: campos });
  }

  // Las garantías son una fila y nada más: no tienen sub-recursos que ordenar.
  for (const g of ops.collaterals.add) out.push({ path: sub('collaterals'), method: 'POST', body: collateralPayload(g) });
  for (const g of ops.collaterals.update) {
    out.push({ path: sub('collaterals', `/${g.serverId!}`), method: 'PATCH', body: collateralPayload(g) });
  }

  // Los del garante que ya existía. Se borran primero, igual que arriba.
  for (const rid of ops.relationContacts.removeIds) out.push({ path: sub('contacts', `/${rid}`), method: 'DELETE' });
  for (const rid of ops.relationLocations.removeIds) out.push({ path: sub('locations', `/${rid}`), method: 'DELETE' });
  for (const c of ops.relationContacts.add) {
    out.push({ path: sub('contacts'), method: 'POST', body: { ...contactPayload(c), relationId: c.relationId } });
  }
  for (const c of ops.relationContacts.update) {
    out.push({ path: sub('contacts', `/${c.serverId!}`), method: 'PATCH', body: contactPayload(c) });
  }
  for (const l of ops.relationLocations.add) {
    out.push({ path: sub('locations'), method: 'POST', body: { ...locationPayload(l), relationId: l.relationId } });
  }
  for (const l of ops.relationLocations.update) {
    out.push({ path: sub('locations', `/${l.serverId!}`), method: 'PATCH', body: locationPayload(l) });
  }

  return out;
}
