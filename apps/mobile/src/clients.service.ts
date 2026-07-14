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

/** Payload del alta atómica (§5.1): cliente + teléfono(s) + ubicación en una sola transacción. */
export interface NewClientInput {
  clientType: 'PERSON' | 'BUSINESS';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId?: string;
  preferredContactChannel?: string;
  contacts?: { contactType: 'PHONE' | 'WHATSAPP'; value: string; isPrimary?: boolean }[];
  location?: {
    address?: string;
    zone?: string;
    latitude?: number;
    longitude?: number;
    referenceNotes?: string;
    photoUrls?: string[];
  };
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
