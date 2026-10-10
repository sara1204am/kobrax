import type { CollectionProfile, CollectionProfileForm } from '../types/client.types.js';

/**
 * Perfil de cobro: **cómo conviene cobrarle** a un cliente en un lugar concreto (F4/13 · E2).
 *
 * «Cobrar todos los días en el negocio», «no tiene tiempo: hay que recoger la cuota». Hoy eso vive en la memoria del
 * cobrador. Se guarda en `client_locations.visit_schedule` (una columna JSON que ya existía y nadie leía): el cobro es
 * **por lugar** —el negocio no es el domicilio—, no por cliente (D-16).
 *
 * Todo es opcional: un perfil vacío no existe. Ninguna regla puede asumir que está.
 */

export const COLLECTION_FREQUENCIES = ['DAILY', 'WEEKLY', 'PER_INSTALLMENT'] as const;
export type CollectionFrequency = (typeof COLLECTION_FREQUENCIES)[number];

/** Quién entrega la cuota. */
export const HANDOVER_PARTIES = ['HOLDER', 'FAMILY', 'EMPLOYEE'] as const;
export type HandoverParty = (typeof HANDOVER_PARTIES)[number];

export const COLLECTION_NOTE_MAX_LENGTH = 280;
export const COLLECTION_MODALITY_MAX_LENGTH = 40;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CODE = /^[A-Z0-9_]+$/;
const KNOWN_FIELDS = ['modality', 'frequency', 'window', 'days', 'handoverBy', 'note'] as const;

/** Por qué un perfil no es válido: un código, no una frase (cada lado la dice en su idioma). */
export type CollectionProfileError =
  | 'NOT_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'MODALITY_INVALID'
  | 'FREQUENCY_INVALID'
  | 'WINDOW_INVALID'
  | 'DAYS_INVALID'
  | 'HANDOVER_INVALID'
  | 'NOTE_INVALID';

/**
 * `null` = válido. Estricto con los campos desconocidos: hasta ahora la API guardaba **cualquier** objeto en esta
 * columna, y un campo que nadie lee es un campo que nadie sabe qué significa.
 */
export function validateCollectionProfile(value: unknown): CollectionProfileError | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'NOT_OBJECT';
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !(KNOWN_FIELDS as readonly string[]).includes(k))) return 'UNKNOWN_FIELD';

  if (v.modality !== undefined) {
    if (typeof v.modality !== 'string' || v.modality.length === 0 || v.modality.length > COLLECTION_MODALITY_MAX_LENGTH || !CODE.test(v.modality)) return 'MODALITY_INVALID';
  }
  if (v.frequency !== undefined && !(COLLECTION_FREQUENCIES as readonly string[]).includes(String(v.frequency))) return 'FREQUENCY_INVALID';

  if (v.window !== undefined) {
    const w = v.window as Record<string, unknown> | null;
    if (w === null || typeof w !== 'object' || Array.isArray(w)) return 'WINDOW_INVALID';
    const { from, to } = w;
    if (typeof from !== 'string' || typeof to !== 'string' || !HHMM.test(from) || !HHMM.test(to)) return 'WINDOW_INVALID';
    // Un rango que termina antes de empezar no es una franja: es un error de tipeo («18:00»–«08:00»).
    if (from >= to) return 'WINDOW_INVALID';
  }

  if (v.days !== undefined) {
    const d = v.days;
    // 1 = lunes … 7 = domingo (ISO). Sin repetidos.
    if (!Array.isArray(d) || d.length === 0 || d.length > 7 || !d.every((n) => Number.isInteger(n) && n >= 1 && n <= 7) || new Set(d).size !== d.length) return 'DAYS_INVALID';
  }

  if (v.handoverBy !== undefined && !(HANDOVER_PARTIES as readonly string[]).includes(String(v.handoverBy))) return 'HANDOVER_INVALID';
  if (v.note !== undefined && (typeof v.note !== 'string' || v.note.length > COLLECTION_NOTE_MAX_LENGTH)) return 'NOTE_INVALID';
  return null;
}

// ── Formulario ↔ perfil ─────────────────────────────────────────────────────────────────────────

export function emptyCollectionForm(): CollectionProfileForm {
  return { modality: '', frequency: '', windowFrom: '', windowTo: '', days: [], handoverBy: '', note: '' };
}

/**
 * ¿La fila del formulario tiene algo? Un perfil en blanco no se guarda.
 *
 * 🔴 Tolera que **falte** (`null`/`undefined`): una fila de ubicación armada antes de que existiera el campo —un
 * borrador, una caché— no trae `collection`, y guardar no puede romperse por eso. Falta = vacío.
 */
export function hasCollectionData(f: CollectionProfileForm | null | undefined): boolean {
  if (!f) return false;
  return !!(f.modality || f.frequency || f.windowFrom || f.windowTo || (f.days?.length ?? 0) > 0 || f.handoverBy || f.note?.trim());
}

/**
 * El JSON de la base → el formulario. Tolerante: lo que no se reconoce se ignora, porque la columna aceptó cualquier
 * objeto antes de que este esquema existiera y **abrir la ficha de un cliente antiguo no puede fallar**.
 */
export function collectionFormFromProfile(value: unknown): CollectionProfileForm {
  const f = emptyCollectionForm();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return f;
  const v = value as Record<string, unknown>;
  if (typeof v.modality === 'string') f.modality = v.modality;
  if (typeof v.frequency === 'string' && (COLLECTION_FREQUENCIES as readonly string[]).includes(v.frequency)) f.frequency = v.frequency;
  const w = v.window as Record<string, unknown> | undefined;
  if (w && typeof w === 'object') {
    if (typeof w.from === 'string' && HHMM.test(w.from)) f.windowFrom = w.from;
    if (typeof w.to === 'string' && HHMM.test(w.to)) f.windowTo = w.to;
  }
  if (Array.isArray(v.days)) f.days = v.days.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 7);
  if (typeof v.handoverBy === 'string' && (HANDOVER_PARTIES as readonly string[]).includes(v.handoverBy)) f.handoverBy = v.handoverBy;
  if (typeof v.note === 'string') f.note = v.note;
  return f;
}

/**
 * El formulario → el perfil que se manda. `undefined` si no hay nada.
 *
 * Solo viaja la franja si están **las dos** horas: media franja no es una franja.
 */
export function collectionProfileFromForm(f: CollectionProfileForm | null | undefined): CollectionProfile | undefined {
  if (!f || !hasCollectionData(f)) return undefined;
  const p: CollectionProfile = {};
  if (f.modality) p.modality = f.modality;
  if (f.frequency) p.frequency = f.frequency as CollectionFrequency;
  if (f.windowFrom && f.windowTo) p.window = { from: f.windowFrom, to: f.windowTo };
  if ((f.days?.length ?? 0) > 0) p.days = [...f.days].sort((a, b) => a - b);
  if (f.handoverBy) p.handoverBy = f.handoverBy as HandoverParty;
  const note = (f.note ?? '').trim();
  if (note) p.note = note;
  return Object.keys(p).length > 0 ? p : undefined;
}

/** Igualdad para el diff: dos formularios que producen el mismo perfil son el mismo. */
export function sameCollection(a: CollectionProfileForm | null | undefined, b: CollectionProfileForm | null | undefined): boolean {
  return JSON.stringify(collectionProfileFromForm(a) ?? null) === JSON.stringify(collectionProfileFromForm(b) ?? null);
}

/** ¿Qué mensaje de error del formulario corresponde? Solo lo que el usuario puede cometer a mano. */
export function collectionFormError(f: CollectionProfileForm | null | undefined): CollectionProfileError | null {
  if (!f) return null;
  if ((f.windowFrom && !f.windowTo) || (!f.windowFrom && f.windowTo)) return 'WINDOW_INVALID';
  const p = collectionProfileFromForm(f);
  return p ? validateCollectionProfile(p) : null;
}
