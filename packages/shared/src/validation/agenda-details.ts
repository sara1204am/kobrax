/**
 * Validación de `agenda_items.details` (JSONB): los campos propios de cada tipo de gestión.
 * Función pura, cero deps — la consumen la API (antes de escribir) y el móvil (antes de enviar),
 * así el mensaje de error es el mismo y la regla vive en un solo lugar.
 *
 * Los cruces contra la DB (que el `contactId` sea del cliente, que el monto no exceda el saldo,
 * que el medio de pago exista en el catálogo) NO van acá: no son puros. Los hace `AgendaService`.
 */
import { AgendaItemType } from '../enums/agenda.enum.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CallDetails {
  contactId: string;
}
export interface WhatsAppDetails {
  contactId: string;
  message: string;
}
export interface VisitCustomAddress {
  address: string;
  zone?: string;
  reference?: string;
}
/** Visita: o una dirección guardada del cliente, o una dirección libre. */
export type VisitDetails = { locationId: string } | { customAddress: VisitCustomAddress };
export interface ReminderDetails {
  description: string;
}
export interface PromiseToPayDetails {
  amount: number;
  promiseDate: string;
  paymentMethodCode: string;
  bankCode?: string;
}

export type AgendaDetails =
  | CallDetails
  | WhatsAppDetails
  | VisitDetails
  | ReminderDetails
  | PromiseToPayDetails;

export type AgendaDetailsResult =
  | { ok: true; value: AgendaDetails }
  | { ok: false; errors: string[] };

/** Acumula errores mientras extrae; devuelve `''`/`0` en el campo inválido (ya reportado). */
class Extractor {
  readonly errors: string[] = [];
  constructor(private readonly d: Record<string, unknown>) {}

  uuid(key: string): string {
    const v = this.d[key];
    if (typeof v !== 'string' || !UUID.test(v)) {
      this.errors.push(`${key}: se requiere un identificador válido`);
      return '';
    }
    return v;
  }

  text(key: string, max: number, source: Record<string, unknown> = this.d): string {
    const v = source[key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      this.errors.push(`${key}: es obligatorio`);
      return '';
    }
    const trimmed = v.trim();
    if (trimmed.length > max) {
      this.errors.push(`${key}: no puede superar ${max} caracteres`);
      return '';
    }
    return trimmed;
  }

  optionalText(key: string, max: number, source: Record<string, unknown> = this.d): string | undefined {
    const v = source[key];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || v.trim().length > max) {
      this.errors.push(`${key}: no puede superar ${max} caracteres`);
      return undefined;
    }
    return v.trim();
  }

  /** Monto positivo con hasta 2 decimales (los centavos de la promesa de pago). */
  money(key: string): number {
    const v = this.d[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      this.errors.push(`${key}: debe ser un monto mayor a cero`);
      return 0;
    }
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) {
      this.errors.push(`${key}: admite como máximo 2 decimales`);
      return 0;
    }
    return v;
  }

  isoDate(key: string): string {
    const v = this.d[key];
    if (typeof v !== 'string' || !ISO_DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      this.errors.push(`${key}: se requiere una fecha válida (YYYY-MM-DD)`);
      return '';
    }
    return v;
  }
}

/**
 * Valida `details` contra su `type` y devuelve el objeto normalizado (strings trimeados,
 * claves ajenas descartadas) o la lista de errores en español, lista para mostrar.
 */
export function validateAgendaDetails(type: `${AgendaItemType}`, details: unknown): AgendaDetailsResult {
  const raw = typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {};
  const e = new Extractor(raw);
  const done = (value: AgendaDetails): AgendaDetailsResult =>
    e.errors.length > 0 ? { ok: false, errors: e.errors } : { ok: true, value };

  switch (type) {
    case AgendaItemType.CALL:
      return done({ contactId: e.uuid('contactId') });

    case AgendaItemType.WHATSAPP:
      return done({ contactId: e.uuid('contactId'), message: e.text('message', 1000) });

    case AgendaItemType.REMINDER:
      return done({ description: e.text('description', 500) });

    case AgendaItemType.VISIT: {
      const custom = raw.customAddress;
      if (typeof custom === 'object' && custom !== null) {
        const c = custom as Record<string, unknown>;
        return done({
          customAddress: {
            address: e.text('address', 200, c),
            zone: e.optionalText('zone', 100, c),
            reference: e.optionalText('reference', 200, c),
          },
        });
      }
      return done({ locationId: e.uuid('locationId') });
    }

    case AgendaItemType.PROMISE_TO_PAY:
      return done({
        amount: e.money('amount'),
        promiseDate: e.isoDate('promiseDate'),
        paymentMethodCode: e.text('paymentMethodCode', 50),
        bankCode: e.optionalText('bankCode', 50),
      });

    default:
      return { ok: false, errors: [`type: tipo de gestión desconocido (${String(type)})`] };
  }
}
