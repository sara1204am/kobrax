import { CASE_SORTS, CASE_TRANSITIONS, CasePriority, CaseStatus } from '@kobrax/shared';

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
 * Las claves de orden que `GET /cases` sabe resolver — salen de `shared`, que es donde vive el
 * contrato. Una que no esté ahí **no viaja**: el servidor caería a su orden por defecto y la tabla
 * mostraría una flecha de orden que no ordenó nada.
 */
export { CASE_SORTS } from '@kobrax/shared';

/** Lo que la pantalla de Mora sabe leer de la URL. Las claves son las que escribe el `DataTable`. */
export interface MoraParams {
  status?: string;
  priority?: string;
  assigneeId?: string;
  /** SLA del caso vencido — **no** la mora del deudor. Son dos cosas distintas. */
  overdue?: string;
  /** Rango de días de mora del crédito. Vacío = el default de la pantalla (`1`, sólo vencidos). */
  dpdMin?: string;
  dpdMax?: string;
  /** `'0'` explícito = «mostrar también los que están al día». */
  todos?: string;
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

/**
 * La query para `GET /cases` a partir de lo que hay en la URL.
 *
 * `overdue` viaja como `'true'`, no como booleano: el DTO lo valida como string. Y un filtro
 * vacío **no se manda**, o la API lo tomaría como un filtro de verdad.
 *
 * 🔴 **Abre por vencidos: `dpdMin=1` si nadie dijo otra cosa.** La pantalla se llama Mora, y sin
 * esto listaba todo el trabajo abierto — incluyendo a quien está al día y sólo tiene el expediente
 * sin cerrar. «Ver también los que están al día» es un filtro que se saca, no el estado inicial.
 */
export function moraQuery(params: MoraParams, limit: number): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const key of ['status', 'priority', 'assigneeId', 'q'] as const) {
    if (params[key]) query.set(key, params[key]!);
  }
  if (params.overdue === 'true') query.set('overdue', 'true');

  if (params.dpdMin) query.set('dpdMin', params.dpdMin);
  else if (params.todos !== '1') query.set('dpdMin', '1'); // el default de la pantalla
  if (params.dpdMax) query.set('dpdMax', params.dpdMax);

  /*
   * Sin estado pedido a mano, la lista es **la del trabajo abierto**, que es lo que promete su
   * propio subtítulo. Sin esto, en un tenant con historia la primera página mezcla cerrados con
   * vivos y —ordenando por prioridad— un crítico cerrado hace meses queda arriba del alto de hoy.
   * Con un estado elegido manda ése, incluso si es terminal: pedir «Cerrados» tiene que traerlos.
   */
  if (!params.status) query.set('open', 'true');
  // El `as` es porque `CASE_SORTS` es una tupla de literales y lo que llega es lo que había en la
  // URL: la comprobación es justamente para saber si es una de ellas.
  if (params.sort && (CASE_SORTS as readonly string[]).includes(params.sort)) {
    query.set('sort', params.sort);
    query.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  }
  return query;
}

/**
 * ¿Hay algún filtro puesto? Decide si el vacío se cuenta como «no hay» o como «no encontré».
 *
 * El `dpdMin=1` que la pantalla pone sola **no cuenta**: es cómo abre, no algo que alguien eligió.
 * Contarlo haría que una cartera sin mora dijera «no encontré nada con esos filtros» cuando la
 * respuesta verdadera es «nadie te debe», que es una noticia distinta y mejor.
 */
export function hasMoraFilters(params: MoraParams): boolean {
  return Boolean(
    params.status || params.priority || params.assigneeId || params.q || params.dpdMin || params.dpdMax ||
      params.overdue === 'true' || params.todos === '1',
  );
}
