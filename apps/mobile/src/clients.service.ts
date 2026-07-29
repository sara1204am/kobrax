/**
 * Clientes (lectura + alta). Thin sobre `apiQuery`/`apiMutate`. El buscador ve **todo el tenant** con la
 * PII enmascarada; el filtro por asignación lo aplica `/agenda/clients/:id/context` al elegirlo.
 */
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';

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
export function searchClients(q: string): Promise<QueryResult<ClientHit[]>> {
  return apiQuery<ClientHit[]>(`/clients${toQuery({ q, status: 'ACTIVE', limit: 20 })}`);
}

/** Sub-recursos del alta anidada (§5.1). Valores = enums de la API (Prisma). */
export interface NewContactInput {
  contactType: 'PHONE' | 'WHATSAPP' | 'EMAIL';
  value: string;
  isPrimary?: boolean;
}
export interface NewLocationInput {
  locationType?: 'HOME' | 'WORK' | 'GUARANTOR' | 'FAMILY' | 'OTHER';
  address?: string;
  zone?: string;
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
  photoUrls?: string[];
}
export interface NewRelationInput {
  relatedName: string;
  relationshipType: 'GUARANTOR' | 'FAMILY' | 'COWORKER' | 'NEIGHBOR' | 'OTHER';
  gender?: string;
  isContactable?: boolean;
  notes?: string;
  /** El contacto (persona) tiene sus propios teléfonos y ubicaciones (1..N). */
  contacts?: NewContactInput[];
  locations?: NewLocationInput[];
}

/** Payload del alta atómica (§5.1): cliente + contactos + ubicaciones + relaciones en una transacción. */
export interface NewClientInput {
  clientType: 'PERSON' | 'COMPANY';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId?: string;
  gender?: string;
  riskSegment?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  preferredContactChannel?: string;
  contacts?: NewContactInput[];
  locations?: NewLocationInput[];
  relations?: NewRelationInput[];
}

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

export interface ClientContactDetail {
  id: string;
  contactType: 'PHONE' | 'WHATSAPP' | 'EMAIL';
  value: string | null;
  isPrimary: boolean;
}
export interface ClientLocationDetail {
  id: string;
  locationType: 'HOME' | 'WORK' | 'GUARANTOR' | 'FAMILY' | 'OTHER';
  address: string | null;
  zone?: string;
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
  photoUrls?: string[];
}
export interface ClientRelationDetail {
  id: string;
  relatedName: string;
  relationshipType: 'GUARANTOR' | 'FAMILY' | 'COWORKER' | 'NEIGHBOR' | 'OTHER';
  gender?: string;
  isContactable: boolean;
  notes?: string;
  contacts?: ClientContactDetail[];
  locations?: ClientLocationDetail[];
}

/**
 * Detalle del cliente para prellenar el formulario. Con `reveal` los teléfonos y direcciones vienen
 * **en claro** (el server lo audita) — sin eso, editar guardaría la máscara encima del dato real.
 */
export interface ClientDetail {
  id: string;
  clientType: 'PERSON' | 'COMPANY';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  gender?: string;
  nationalId: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  riskSegment?: string;
  contacts?: ClientContactDetail[];
  locations?: ClientLocationDetail[];
  relations?: ClientRelationDetail[];
}

export function getClient(id: string, reveal = false): Promise<QueryResult<ClientDetail>> {
  return apiQuery<ClientDetail>(`/clients/${id}${reveal ? '?reveal=true' : ''}`);
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
