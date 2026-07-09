/**
 * Clientes (lectura). Thin sobre `apiQuery`. El buscador ve **todo el tenant** con la PII
 * enmascarada; el filtro por asignación lo aplica `/agenda/clients/:id/context` al elegirlo.
 */
import { apiQuery, toQuery, type QueryResult } from './api-client';

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
