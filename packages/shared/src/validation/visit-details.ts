/**
 * Validación de `field_visits.details` (JSONB): los campos propios de cada variante del sheet de
 * resultado (Rutas S5 · RT-6). Espejo exacto de `validateAgendaDetails` — misma forma, mismo
 * contrato, misma razón: la regla vive en un solo lugar y la corren la API (antes de escribir) y el
 * móvil (antes de enviar), así el cobrador ve el mismo mensaje que aplicaría el server.
 *
 * Los cruces contra la DB (que la categoría exista en el catálogo del tenant) NO van acá: no son
 * puros. Los hace `FieldService`.
 */
import { VisitOutcome } from '../enums/visit-outcome.enum.js';

/** Por dónde se intentó el contacto que no respondió. */
export type AttemptChannel = 'CALL' | 'DOOR';
const CHANNELS: AttemptChannel[] = ['CALL', 'DOOR'];

export interface NoContactDetails {
  channel: AttemptChannel;
  /** El cobrador fue al domicilio y dejó el aviso de cobro impreso. */
  noticeLeft?: boolean;
}
export interface SpecialDetails {
  categoryCode: string;
}
/** Sin campos propios: la variante se explica sola con el `outcome` y las notas. */
export type NoExtraVisitDetails = Record<string, never>;

export type VisitResultDetails = NoContactDetails | SpecialDetails | NoExtraVisitDetails;

export type VisitResultDetailsResult =
  | { ok: true; value: VisitResultDetails }
  | { ok: false; errors: string[] };

/**
 * Marca de que la coordenada NO es una lectura real del GPS sino la ubicación conocida de la parada
 * (§5.4 del plan: sin permiso o sin señal el registro no se bloquea). La agrega el server, no el
 * cliente — por eso no se valida ni se acepta desde el body.
 */
export const GPS_FALLBACK_KEY = 'gpsFallback';

/**
 * Valida `details` contra el `outcome` y devuelve el objeto normalizado (claves ajenas descartadas)
 * o la lista de errores en español, lista para mostrar.
 */
export function validateVisitDetails(outcome: `${VisitOutcome}`, details: unknown): VisitResultDetailsResult {
  const raw = typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {};

  switch (outcome) {
    case VisitOutcome.NO_CONTACT: {
      const channel = raw.channel;
      if (!CHANNELS.includes(channel as AttemptChannel)) {
        return { ok: false, errors: ['channel: indicá si intentaste por llamada o en la puerta'] };
      }
      const value: NoContactDetails = { channel: channel as AttemptChannel };
      // Sólo se guarda cuando es verdadero: un `false` explícito y la ausencia significan lo mismo,
      // y guardar los dos obliga a distinguirlos después.
      if (raw.noticeLeft === true) value.noticeLeft = true;
      return { ok: true, value };
    }

    case VisitOutcome.SPECIAL: {
      const code = raw.categoryCode;
      if (typeof code !== 'string' || code.trim().length === 0) {
        return { ok: false, errors: ['categoryCode: elegí la categoría de la gestión especial'] };
      }
      if (code.trim().length > 50) {
        return { ok: false, errors: ['categoryCode: no puede superar 50 caracteres'] };
      }
      return { ok: true, value: { categoryCode: code.trim() } };
    }

    // El resto de las variantes (cobrado, promesa, dirección incorrecta) no tienen campos propios:
    // lo que las distingue ya está en el `outcome`, en el pago o en la promesa que crean aparte.
    default:
      return { ok: true, value: {} };
  }
}
