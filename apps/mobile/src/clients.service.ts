/**
 * Clientes (lectura + alta). Thin sobre `apiQuery`/`apiMutate`. El buscador ve **todo el tenant** con la
 * PII enmascarada; el filtro por asignación lo aplica `/agenda/clients/:id/context` al elegirlo.
 */
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import { cachedOne } from './sync/cached';
import * as db from './db';

export interface ClientHit {
  id: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  /** Enmascarado en el listado (`88****03`); en claro solo en el contexto de agendar. */
  nationalId: string | null;
}

/** Nombre visible del cliente (persona o empresa). */
export function clientDisplayName(c: Pick<ClientHit, 'firstName' | 'lastName' | 'businessName'>): string {
  return c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Sin nombre';
}

/** Busca por nombre (ILIKE) o documento exacto. Se llama con debounce desde el formulario. */
export async function searchClients(q: string): Promise<QueryResult<ClientHit[]>> {
  const res = await apiQuery<ClientHit[]>(`/clients${toQuery({ q, status: 'ACTIVE', limit: 20 })}`);
  return res.status === 'offline' ? searchLocal(q) : res;
}

/** Sin acentos y en minúsculas: "MARTINEZ" tiene que encontrar a "Martínez". */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Buscar sin señal. **No va contra el caché de esta consulta** —cada texto tecleado sería una
 * consulta distinta y nunca habría un resultado guardado para lo que el cobrador escribe ahora—
 * sino contra la CARTERA ya bajada, que es la lista completa de su gente.
 *
 * `ponytail:` sale de los casos cacheados y no de un caché de clientes propio, porque la cartera
 * ya se hidrata entera y trae `clientName`. Bajar además todas las fichas sería pagar dos veces
 * por el mismo dato. El documento no viaja en esa lista, así que sin señal se busca por nombre.
 */
async function searchLocal(q: string): Promise<QueryResult<ClientHit[]>> {
  const term = normalizar(q.trim());
  if (!term) return { status: 'offline' };

  const casos = await db.getMany<{ clientId?: string; clientName?: string }>('case');
  const vistos = new Set<string>();
  const hits: ClientHit[] = [];
  for (const c of casos) {
    if (!c.clientId || !c.clientName || vistos.has(c.clientId)) continue;
    if (!normalizar(c.clientName).includes(term)) continue;
    vistos.add(c.clientId);
    // El nombre viene entero (no separado en nombre/apellido) y `clientDisplayName` lee primero
    // `businessName`, así que se muestra tal cual lo devolvió el server.
    hits.push({ id: c.clientId, businessName: c.clientName, nationalId: null });
  }
  if (hits.length === 0) return { status: 'offline' };
  return { status: 'ok', data: hits.slice(0, 20), total: hits.length, localAt: await db.fetchedAt('case') };
}

/**
 * Payload del alta atómica (§5.1) y sus sub-recursos. **Viven en `@kobrax/shared`** desde F9 · W3:
 * el panel web da de alta contra el mismo endpoint. Se re-exportan para no tocar a quien los
 * importaba de acá.
 */
export type {
  NewClientInput,
  NewCollateralInput,
  NewContactInput,
  NewLocationInput,
  NewRelationInput,
} from '@kobrax/shared';
import type {
  NewClientInput,
  NewCollateralInput,
  NewContactInput,
  NewLocationInput,
  NewRelationInput,
} from '@kobrax/shared';

export interface CreatedClient {
  id: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
}

/** Alta de cliente (+ contacto/ubicación anidados). El server crea todo en una transacción. */
export function createClient(input: NewClientInput): Promise<MutateResult<CreatedClient>> {
  return apiMutate<CreatedClient>('/clients', 'POST', input);
}

/**
 * Detalle del cliente para prellenar el formulario. Con `reveal` los teléfonos y direcciones vienen
 * **en claro** (el server lo audita) — sin eso, editar guardaría la máscara encima del dato real.
 *
 * **Vive en `@kobrax/shared`** desde F9 · W3: la ficha del panel web lee el mismo contrato.
 */
export type {
  ClientAttachmentDetail,
  ClientContactDetail,
  ClientDetail,
  ClientLocationDetail,
  ClientRelationDetail,
} from '@kobrax/shared';
import type { ClientDetail } from '@kobrax/shared';

export function getClient(id: string, reveal = false): Promise<QueryResult<ClientDetail>> {
  // `reveal` pide PII en claro y queda auditado en el server: **eso nunca sale del caché**, se
  // pide en línea siempre. Sin `reveal` es la ficha normal y sí tiene respaldo local.
  if (reveal) return apiQuery<ClientDetail>(`/clients/${id}?reveal=true`);
  return cachedOne<ClientDetail>('client', id, () => apiQuery<ClientDetail>(`/clients/${id}`));
}

// ── Sub-recursos (los usa el formulario único al guardar una edición) ─────────
export function addContact(clientId: string, input: NewContactInput & { relationId?: string }) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/contacts`, 'POST', input);
}
export function updateContact(clientId: string, contactId: string, input: Partial<NewContactInput>) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/contacts/${contactId}`, 'PATCH', input);
}
export function removeContact(clientId: string, contactId: string) {
  return apiMutate<null>(`/clients/${clientId}/contacts/${contactId}`, 'DELETE');
}

export function addLocation(clientId: string, input: NewLocationInput & { relationId?: string }) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/locations`, 'POST', input);
}
export function updateLocation(clientId: string, locationId: string, input: NewLocationInput) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/locations/${locationId}`, 'PATCH', input);
}
export function removeLocation(clientId: string, locationId: string) {
  return apiMutate<null>(`/clients/${clientId}/locations/${locationId}`, 'DELETE');
}

export function addRelation(clientId: string, input: NewRelationInput) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/relations`, 'POST', input);
}
export function updateRelation(clientId: string, relationId: string, input: Partial<Omit<NewRelationInput, 'contacts' | 'locations'>>) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/relations/${relationId}`, 'PATCH', input);
}
export function removeRelation(clientId: string, relationId: string) {
  return apiMutate<null>(`/clients/${clientId}/relations/${relationId}`, 'DELETE');
}

// Garantías: el bien que respalda el crédito (la personal es el garante, arriba).
export function addCollateral(clientId: string, input: NewCollateralInput) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/collaterals`, 'POST', input);
}
export function updateCollateral(clientId: string, collateralId: string, input: NewCollateralInput) {
  return apiMutate<{ id: string }>(`/clients/${clientId}/collaterals/${collateralId}`, 'PATCH', input);
}
export function removeCollateral(clientId: string, collateralId: string) {
  return apiMutate<null>(`/clients/${clientId}/collaterals/${collateralId}`, 'DELETE');
}

export interface UpdateClientPatch {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  gender?: string;
  riskSegment?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
}

export function updateClient(id: string, patch: UpdateClientPatch): Promise<MutateResult<ClientDetail>> {
  return apiMutate<ClientDetail>(`/clients/${id}`, 'PATCH', patch);
}
