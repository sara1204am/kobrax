import { CASE_TRANSITIONS, CasePriority, CaseStatus } from '@kobrax/shared';

/**
 * A quién se asignó la cobranza, según la nota de una actividad `ASSIGNMENT`.
 *
 * 🔴 **Devuelve el id, nunca un texto para mostrar.** La nota trae hoy el id pelado, y las filas
 * viejas traen `Asignado a <uuid>` —así lo escribía la API—: las dos formas dan lo mismo, así que la
 * bitácora deja de mostrarle un uuid a una persona también para lo ya registrado. Quien llama
 * resuelve el nombre contra el equipo; sin nombre se dice «sin identificar», no el id.
 */
export function assignedTo(notes?: string | null): string | null {
  return notes?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
}

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
