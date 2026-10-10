import { INCOME_CYCLES, INCOME_SOURCE_CODES, IncomeCycle } from '../enums/income.enum.js';
import type { IncomeProfile, IncomeProfileForm } from '../types/client.types.js';

/**
 * Perfil de ingreso del cliente: de qué vive y cuándo le llega el dinero (F4/13 · E3).
 *
 * Todo es opcional y **ninguna regla puede asumir que existe**. Con él la aplicación puede, sin IA, no insistir antes
 * de que le llegue el dinero a alguien con ingreso trimestral y proponer una fecha de promesa razonable (capa B).
 *
 * El día solo tiene sentido con un ciclo que lo tenga: semanal (1–7, ISO) y mensual o trimestral (1–31). En quincenal,
 * diario, por temporada o irregular no hay un día que decir.
 */

export const INCOME_NOTES_MAX_LENGTH = 280;
const CODE = /^[A-Z0-9_]+$/;
const CODE_MAX = 40;
const KNOWN = ['incomeSourceCode', 'occupationCode', 'incomeCycle', 'incomeDay', 'notes', 'origin'] as const;
const ORIGINS = ['MANUAL', 'DICTATION', 'IMPORT', 'SUGGESTION_ACCEPTED'] as const;

/** Ciclos que admiten día y su rango. */
const DAY_RANGE: Partial<Record<IncomeCycle, [number, number]>> = {
  [IncomeCycle.WEEKLY]: [1, 7],
  [IncomeCycle.MONTHLY]: [1, 31],
  [IncomeCycle.QUARTERLY]: [1, 31],
};

export type IncomeProfileError =
  | 'NOT_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'SOURCE_INVALID'
  | 'OCCUPATION_INVALID'
  | 'CYCLE_INVALID'
  | 'DAY_INVALID'
  | 'DAY_NOT_ALLOWED'
  | 'NOTES_INVALID'
  | 'ORIGIN_INVALID';

/** ¿Este ciclo admite un día? Lo usa la pantalla para mostrar u ocultar el campo. */
export const cycleHasDay = (cycle: string | undefined | null): boolean => !!cycle && cycle in DAY_RANGE;

/** El rango de días de un ciclo, o `null` si no tiene. */
export const dayRangeOf = (cycle: string | undefined | null): [number, number] | null => (cycle ? DAY_RANGE[cycle as IncomeCycle] ?? null : null);

/**
 * `null` = válido. Estricto con campos desconocidos y con los códigos: la fuente de ingreso es de un conjunto fijo
 * (filtra los motivos que se ofrecen); el rubro es un código de catálogo **sin verificar que exista** a propósito: la
 * cuenta puede haberlo sacado del catálogo y una gestión encolada sin señal no debe fallar por eso (D-34).
 */
export function validateIncomeProfile(value: unknown): IncomeProfileError | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'NOT_OBJECT';
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !(KNOWN as readonly string[]).includes(k))) return 'UNKNOWN_FIELD';

  if (v.incomeSourceCode !== undefined && !(INCOME_SOURCE_CODES as readonly string[]).includes(String(v.incomeSourceCode))) return 'SOURCE_INVALID';
  if (v.occupationCode !== undefined) {
    const o = v.occupationCode;
    if (typeof o !== 'string' || o.length === 0 || o.length > CODE_MAX || !CODE.test(o)) return 'OCCUPATION_INVALID';
  }
  if (v.incomeCycle !== undefined && !(INCOME_CYCLES as readonly string[]).includes(String(v.incomeCycle))) return 'CYCLE_INVALID';

  if (v.incomeDay !== undefined) {
    const range = dayRangeOf(v.incomeCycle as string | undefined);
    if (!range) return 'DAY_NOT_ALLOWED';
    const d = v.incomeDay;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < range[0] || d > range[1]) return 'DAY_INVALID';
  }

  if (v.notes !== undefined && (typeof v.notes !== 'string' || v.notes.length > INCOME_NOTES_MAX_LENGTH)) return 'NOTES_INVALID';
  if (v.origin !== undefined && !(ORIGINS as readonly string[]).includes(String(v.origin))) return 'ORIGIN_INVALID';
  return null;
}

// ── Formulario ↔ perfil ─────────────────────────────────────────────────────────────────────────

export function emptyIncomeForm(): IncomeProfileForm {
  return { incomeSourceCode: '', occupationCode: '', incomeCycle: '', incomeDay: '', notes: '' };
}

/** ¿La fila del formulario tiene algo? Tolera que falte: un borrador anterior al campo no trae `income`. */
export function hasIncomeData(f: IncomeProfileForm | null | undefined): boolean {
  if (!f) return false;
  return !!(f.incomeSourceCode || f.occupationCode || f.incomeCycle || String(f.incomeDay ?? '').trim() || (f.notes ?? '').trim());
}

/** El JSON del servidor → el formulario. Tolerante: lo que no se reconoce se ignora. */
export function incomeFormFromProfile(value: unknown): IncomeProfileForm {
  const f = emptyIncomeForm();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return f;
  const v = value as Record<string, unknown>;
  if (typeof v.incomeSourceCode === 'string') f.incomeSourceCode = v.incomeSourceCode;
  if (typeof v.occupationCode === 'string') f.occupationCode = v.occupationCode;
  if (typeof v.incomeCycle === 'string' && (INCOME_CYCLES as readonly string[]).includes(v.incomeCycle)) f.incomeCycle = v.incomeCycle;
  if (typeof v.incomeDay === 'number' && Number.isInteger(v.incomeDay)) f.incomeDay = String(v.incomeDay);
  if (typeof v.notes === 'string') f.notes = v.notes;
  return f;
}

/**
 * El formulario → el perfil que se manda. `undefined` si no hay nada.
 *
 * El día solo viaja si el ciclo lo admite: cambiar de «mensual» a «diario» no deja un `15` huérfano que el servidor
 * rechazaría.
 */
export function incomeProfileFromForm(f: IncomeProfileForm | null | undefined, origin?: IncomeProfile['origin']): IncomeProfile | undefined {
  if (!f || !hasIncomeData(f)) return undefined;
  const p: IncomeProfile = {};
  if (f.incomeSourceCode) p.incomeSourceCode = f.incomeSourceCode as IncomeProfile['incomeSourceCode'];
  if (f.occupationCode) p.occupationCode = f.occupationCode;
  if (f.incomeCycle) p.incomeCycle = f.incomeCycle as IncomeProfile['incomeCycle'];
  const day = Number(String(f.incomeDay ?? '').trim());
  if (String(f.incomeDay ?? '').trim() !== '' && Number.isInteger(day) && cycleHasDay(f.incomeCycle)) p.incomeDay = day;
  const notes = (f.notes ?? '').trim();
  if (notes) p.notes = notes;
  if (Object.keys(p).length === 0) return undefined;
  if (origin) p.origin = origin;
  return p;
}

/** Igualdad para el diff: dos formularios que producen el mismo perfil son el mismo. */
export function sameIncome(a: IncomeProfileForm | null | undefined, b: IncomeProfileForm | null | undefined): boolean {
  return JSON.stringify(incomeProfileFromForm(a) ?? null) === JSON.stringify(incomeProfileFromForm(b) ?? null);
}

/** Error que la persona puede cometer a mano en el formulario (el día fuera de rango). */
export function incomeFormError(f: IncomeProfileForm | null | undefined): IncomeProfileError | null {
  if (!f) return null;
  const raw = String(f.incomeDay ?? '').trim();
  if (raw !== '') {
    const range = dayRangeOf(f.incomeCycle);
    const n = Number(raw);
    if (!range) return 'DAY_NOT_ALLOWED';
    if (!Number.isInteger(n) || n < range[0] || n > range[1]) return 'DAY_INVALID';
  }
  const p = incomeProfileFromForm(f);
  return p ? validateIncomeProfile(p) : null;
}
