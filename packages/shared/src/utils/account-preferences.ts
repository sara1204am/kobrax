/**
 * Preferencias de trabajo de la cuenta (Refactor de Cuenta · F5): cuándo trabaja el equipo y cómo se muestra la semana.
 *
 * Viven en `accounts.configuration.preferences` (jsonb que ya existía y no se usaba para esto). Función pura y sin
 * dependencias: la usan la API (validar y servir), la web (formulario) y, cuando adopte estas preferencias, el móvil.
 *
 * Quien lee una cuenta que nunca las configuró recibe los valores de fábrica: nada cambia hasta que alguien las toque.
 */

/** 1 = lunes … 7 = domingo (ISO). */
export type WorkDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface AccountPreferences {
  /** Días en que el equipo trabaja, ordenados y sin repetir. Nunca vacío. */
  workDays: number[];
  /** Hora de inicio de la jornada, `HH:MM` (24 h). */
  workStart: string;
  /** Hora de fin de la jornada, `HH:MM`. Siempre posterior a `workStart`. */
  workEnd: string;
  /** Con qué día empieza la semana en los calendarios. */
  weekStart: 'MON' | 'SUN';
  /** Idioma con el que se abre el panel a quien todavía no eligió uno. */
  defaultLocale: 'es' | 'en';
}

/** De lunes a sábado, 8 a 18: la jornada de una cartera de cobranza en campo. */
export const DEFAULT_PREFERENCES: AccountPreferences = {
  workDays: [1, 2, 3, 4, 5, 6],
  workStart: '08:00',
  workEnd: '18:00',
  weekStart: 'MON',
  defaultLocale: 'es',
};

export const WEEK_STARTS = ['MON', 'SUN'] as const;
export const PREFERENCE_LOCALES = ['es', 'en'] as const;

/** `HH:MM` en 24 horas. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export type PreferencesError = 'NO_WORK_DAYS' | 'WORK_DAY_INVALID' | 'TIME_INVALID' | 'END_NOT_AFTER_START';

const isWorkDay = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 7;

/**
 * Qué está mal en un juego de preferencias, o `null` si está bien. Devuelve un código y no una frase: cada lado la dice
 * en su idioma.
 */
export function validatePreferences(p: AccountPreferences): PreferencesError | null {
  if (p.workDays.length === 0) return 'NO_WORK_DAYS';
  if (!p.workDays.every(isWorkDay)) return 'WORK_DAY_INVALID';
  if (!TIME_OF_DAY.test(p.workStart) || !TIME_OF_DAY.test(p.workEnd)) return 'TIME_INVALID';
  // `HH:MM` ordena igual que como texto y como hora: 08:00 < 18:00.
  if (p.workEnd <= p.workStart) return 'END_NOT_AFTER_START';
  return null;
}

/**
 * Las preferencias de una cuenta a partir de su `configuration` tal como está en la base.
 *
 * Lo que venga mal formado (jsonb editado a mano, un valor de una versión vieja) no rompe la lectura: ese campo cae a su
 * valor de fábrica. Un juego que quedaría incoherente en conjunto —por ejemplo fin antes que inicio— se descarta entero.
 */
export function preferencesOf(configuration: unknown): AccountPreferences {
  const raw = (configuration as { preferences?: Partial<Record<keyof AccountPreferences, unknown>> } | null)?.preferences;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFERENCES, workDays: [...DEFAULT_PREFERENCES.workDays] };

  const days = Array.isArray(raw.workDays) && raw.workDays.every(isWorkDay) && raw.workDays.length > 0
    ? [...new Set(raw.workDays as number[])].sort((a, b) => a - b)
    : [...DEFAULT_PREFERENCES.workDays];

  const merged: AccountPreferences = {
    workDays: days,
    workStart: typeof raw.workStart === 'string' && TIME_OF_DAY.test(raw.workStart) ? raw.workStart : DEFAULT_PREFERENCES.workStart,
    workEnd: typeof raw.workEnd === 'string' && TIME_OF_DAY.test(raw.workEnd) ? raw.workEnd : DEFAULT_PREFERENCES.workEnd,
    weekStart: (WEEK_STARTS as readonly unknown[]).includes(raw.weekStart) ? (raw.weekStart as 'MON' | 'SUN') : DEFAULT_PREFERENCES.weekStart,
    defaultLocale: (PREFERENCE_LOCALES as readonly unknown[]).includes(raw.defaultLocale)
      ? (raw.defaultLocale as 'es' | 'en')
      : DEFAULT_PREFERENCES.defaultLocale,
  };
  return validatePreferences(merged) ? { ...DEFAULT_PREFERENCES, workDays: [...DEFAULT_PREFERENCES.workDays] } : merged;
}

/** Lo ya guardado con un parche encima; los días quedan ordenados y sin repetir. */
export function mergePreferences(current: AccountPreferences, patch: Partial<AccountPreferences>): AccountPreferences {
  return {
    ...current,
    ...patch,
    workDays: patch.workDays ? [...new Set(patch.workDays)].sort((a, b) => a - b) : current.workDays,
  };
}

/** Sólo lo que cambió entre dos juegos, listo para mandar como parche. Vacío = nada que guardar. */
export function diffPreferences(before: AccountPreferences, after: AccountPreferences): Partial<AccountPreferences> {
  const out: Partial<AccountPreferences> = {};
  if (before.workDays.join(',') !== after.workDays.join(',')) out.workDays = after.workDays;
  if (before.workStart !== after.workStart) out.workStart = after.workStart;
  if (before.workEnd !== after.workEnd) out.workEnd = after.workEnd;
  if (before.weekStart !== after.weekStart) out.weekStart = after.weekStart;
  if (before.defaultLocale !== after.defaultLocale) out.defaultLocale = after.defaultLocale;
  return out;
}
