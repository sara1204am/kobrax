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
