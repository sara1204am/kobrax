import { cache } from 'react';
import type { AgendaTodaySummary } from '@kobrax/shared';
import { apiCall } from './bff';

/**
 * El resumen de hoy (`GET /agenda/summary`), pedido UNA vez por petición aunque lo usen el menú, el Inicio y la agenda
 * (`cache` de React deduplica dentro del mismo render del servidor).
 *
 * 🔴 Es también **la fuente de «hoy» del panel**: el servidor web corre en UTC y en Bolivia, desde las 20:00, UTC ya es
 * mañana — la agenda abría en el día siguiente y el «Hoy» marcaba otra fecha. El día que dice este resumen es el civil de
 * la empresa, el mismo con que la API cuenta vencidas y pendientes.
 *
 * Devuelve `null` si no hay agenda para este usuario (403) o la API no contesta: quien lo use cae a su propio día.
 */
export const getAgendaSummary = cache(async (): Promise<AgendaTodaySummary | null> => {
  const res = await apiCall<AgendaTodaySummary>('/agenda/summary', { method: 'GET', auth: true }).catch(() => null);
  return res?.status === 200 && res.body.data ? res.body.data : null;
});
