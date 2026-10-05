/**
 * Situación de un crédito (F4/08 · D1). Dos cosas independientes, cada una responde por sí sola:
 *
 *  · **Situación** — Al día / En mora — se deriva ÚNICAMENTE del episodio de mora abierto. Ni los días,
 *    ni una gestión, ni una promesa, ni un pago parcial la cambian.
 *  · **Castigo** — condición aparte (`credits.written_off_at`): puede haber 240 días de mora y estar
 *    castigado, y el crédito sigue «En mora».
 *
 * No existe un estado manual ni uno derivado de gestiones o promesas.
 */
import type { MoraSituationResult } from '../types/sin-caso.types.js';

export interface MoraSituationInput {
  /** ¿Hay un episodio de mora sin cerrar? Es lo único que decide la situación. */
  hasOpenEpisode: boolean;
  /** Informativo (para mostrar «47 días»); NO interviene en la situación. */
  daysPastDue?: number;
  /** Fecha del castigo; `null`/ausente = no castigado. */
  writtenOffAt?: Date | string | null;
}

export function moraSituation(input: MoraSituationInput): MoraSituationResult {
  return {
    situation: input.hasOpenEpisode ? 'IN_ARREARS' : 'CURRENT',
    writtenOff: input.writtenOffAt != null && input.writtenOffAt !== '',
  };
}
