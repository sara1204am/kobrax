import { CasePriority } from '@kobrax/shared';

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

/** Color de la prioridad (del episodio de mora abierto). */
export const PRIORITY_TONE: Record<CasePriority, Tone> = {
  [CasePriority.LOW]: 'neutral',
  [CasePriority.MEDIUM]: 'neutral',
  [CasePriority.HIGH]: 'warning',
  [CasePriority.CRITICAL]: 'danger',
};
