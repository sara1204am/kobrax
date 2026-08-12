import { CASE_TRANSITIONS, CasePriority, CaseStatus } from '@kobrax/shared';

/** Los tonos que sabe pintar el `Badge` del panel. */
type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * A qué estados puede pasar un caso **desde el control de la ficha**.
 *
 * No reimplementa la máquina: sale de `CASE_TRANSITIONS` de `shared`, que es la misma que valida
 * el servidor. Ofrecer un estado que la API va a rechazar con `CASE_002` es prometer algo que no
 * se puede cumplir.
 *
 * 🔴 **`CLOSED` no sale por acá**: tiene su propio endpoint, exige un motivo y pide otro permiso
 * (`case:close`). Mezclarlo con los demás lo haría parecer un cambio de estado más, y es el único
 * que no se puede deshacer.
 */
export function nextStates(from: CaseStatus): CaseStatus[] {
  return (CASE_TRANSITIONS[from] ?? []).filter((to) => to !== CaseStatus.CLOSED);
}

/** ¿Se puede cerrar? Sólo desde `PAID`, y la API además exige que haya una gestión (`CASE_001`). */
export function canClose(from: CaseStatus): boolean {
  return (CASE_TRANSITIONS[from] ?? []).includes(CaseStatus.CLOSED);
}

/**
 * El color del estado. El semáforo mira **el trabajo**, no la plata: pagado y cerrado son verdes,
 * incobrable es rojo, y lo que está en juego (negociación, promesa) es ámbar.
 */
export const STATUS_TONE: Record<CaseStatus, Tone> = {
  [CaseStatus.PENDING]: 'neutral',
  [CaseStatus.ACTIVE]: 'neutral',
  [CaseStatus.IN_NEGOTIATION]: 'warning',
  [CaseStatus.PROMISE_TO_PAY]: 'warning',
  [CaseStatus.PAID]: 'success',
  [CaseStatus.CLOSED]: 'success',
  [CaseStatus.WRITTEN_OFF]: 'danger',
};

export const PRIORITY_TONE: Record<CasePriority, Tone> = {
  [CasePriority.LOW]: 'neutral',
  [CasePriority.MEDIUM]: 'neutral',
  [CasePriority.HIGH]: 'warning',
  [CasePriority.CRITICAL]: 'danger',
};

/**
 * Las claves de orden que `GET /cases` sabe resolver.
 *
 * Una que no esté acá **no viaja**: el servidor la ignoraría y caería a su orden por defecto, así
 * que la tabla mostraría una flecha de orden que no ordena nada.
 */
export const CASE_SORTS = ['priority', 'daysPastDue', 'balance', 'slaDueAt', 'createdAt'];

/**
 * La query para `GET /cases` a partir de lo que hay en la URL.
 *
 * `overdue` viaja como `'true'`, no como booleano: el DTO lo valida como string. Y un filtro
 * vacío **no se manda**, o la API lo tomaría como un filtro de verdad.
 */
export function caseQuery(
  params: { status?: string; priority?: string; assigneeId?: string; overdue?: string; sort?: string; dir?: string; page?: string },
  limit: number,
): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const key of ['status', 'priority', 'assigneeId'] as const) {
    if (params[key]) query.set(key, params[key]);
  }
  if (params.overdue === 'true') query.set('overdue', 'true');
  if (params.sort && CASE_SORTS.includes(params.sort)) {
    query.set('sort', params.sort);
    query.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  }
  return query;
}

/** ¿Hay algún filtro puesto? Decide si el vacío se cuenta como «no hay» o como «no encontré». */
export function hasCaseFilters(params: { status?: string; priority?: string; assigneeId?: string; overdue?: string }): boolean {
  return Boolean(params.status || params.priority || params.assigneeId || params.overdue === 'true');
}
