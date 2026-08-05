/**
 * «Hora recomendada» (Rutas S4, §5.3 del plan): en qué franja conviene buscar a este deudor.
 *
 * No hay un dato de "mejor horario" en ninguna tabla — se deduce del historial: las gestiones que
 * **terminaron en un contacto efectivo** (ejecutadas y con una gestión real colgando) se agrupan por
 * franja, y gana la que más veces funcionó.
 *
 * Pura a propósito: es la parte que puede equivocarse, y así se prueba sin DB.
 */
import { AgendaTimeSlot, slotOfTime } from '@kobrax/shared';

/** Lo mínimo de un `agenda_item` para poder contarlo. */
export interface SlotSource {
  timeSlot: AgendaTimeSlot | string | null;
  scheduledTime: string | null;
}

export interface ContactHint {
  timeSlot: AgendaTimeSlot;
  /** Cuántos contactos efectivos respaldan la franja. El móvil lo muestra ("según 4 contactos"). */
  basedOn: number;
}

/**
 * Con menos de esto no se recomienda nada. Una franja sacada de un solo contacto es una corazonada
 * disfrazada de estadística: se prefiere no mostrar el chip a entrenar al cobrador a ignorarlo.
 */
const MIN_CONTACTS = 2;

/** El orden del día: desempata a favor de la franja más temprana, para que el resultado sea estable. */
const BY_TIME_OF_DAY = [AgendaTimeSlot.MORNING, AgendaTimeSlot.AFTERNOON, AgendaTimeSlot.NIGHT];

export function recommendedSlot(items: SlotSource[]): ContactHint | undefined {
  const count = new Map<AgendaTimeSlot, number>();

  for (const item of items) {
    // La gestión guarda una franja (modo LAPSE) o una hora exacta (modo FIXED). Si no guarda
    // ninguna de las dos, no dice nada sobre el horario y no se cuenta.
    const slot = asSlot(item.timeSlot) ?? (item.scheduledTime ? slotOfTime(item.scheduledTime) : undefined);
    if (!slot) continue;
    count.set(slot, (count.get(slot) ?? 0) + 1);
  }

  let best: ContactHint | undefined;
  for (const slot of BY_TIME_OF_DAY) {
    const basedOn = count.get(slot) ?? 0;
    // `>` y no `>=`: recorriendo en orden del día, el primero en empatar se queda con el puesto.
    if (basedOn >= MIN_CONTACTS && (!best || basedOn > best.basedOn)) best = { timeSlot: slot, basedOn };
  }
  return best;
}

/** El `timeSlot` viene de la DB como texto; sólo cuenta si es una franja conocida. */
function asSlot(value: SlotSource['timeSlot']): AgendaTimeSlot | undefined {
  return BY_TIME_OF_DAY.find((s) => s === value);
}
