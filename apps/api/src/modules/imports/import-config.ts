/**
 * Contrato de `account.configuration.importConfig` + validación de sus invariantes.
 *
 * Es la config que hace genérica a la app (C12): qué archivo se lee, cómo se lee y dónde va
 * cada valor. Vive en JSONB, así que **la validación es acá o no existe**: un JSON mal formado
 * no lo atrapa ninguna FK. Ver FIELD-RULES §3.
 *
 * Función pura, sin Nest ni Prisma → testeable sin levantar nada.
 */
import { FIELD_CATALOG, type NameOrder } from './field-catalog';
import type { FieldMap, PdfBlocksProfile } from './parsers/pdf-blocks.parser';
import type { RowsProfile } from './parsers/rows.parser';

export type ProfileKind = 'pdf-blocks' | 'rows';
export type AbsentRule = 'set-current' | 'no-touch' | 'ask';
export type ScopeKind = 'official' | 'branch' | 'account';

/** Regla por campo: de dónde sale y qué tan obligatorio es (§3.1). */
export interface FieldRule {
  enabled?: boolean;
  required?: boolean;
  /** Etiqueta/encabezado EN EL ARCHIVO. Siempre editable, en todo formato. */
  from?: string;
  /** `table` = columna del cuadro (sólo `pdf-blocks`). Default `header`. */
  in?: 'header' | 'table' | 'below';
  /** Sólo `daysPastDue`: el usuario miró los valores y confirmó la columna (§6.5.1). */
  calibrated?: boolean;
}

export interface ImportConfig {
  source: 'manual' | 'file';
  profile: { kind: ProfileKind } & PdfBlocksProfile & RowsProfile;
  fields: Record<string, FieldRule>;
  nameOrder: NameOrder;
  scope: { kind: ScopeKind; ref: string | null };
  absentRule: AbsentRule;
  carriesAssignee: boolean;
  askOnLogin: boolean;
  /** Sólo informativo: de qué preset partió la configuración. */
  preset?: string;
}

/**
 * Lo que llega en un `PATCH`. Difiere de `Partial<ImportConfig>` en un punto: un campo puesto en
 * `null` se **quita** del emparejado. Sin eso, un campo agregado por error sólo se puede apagar
 * —queda en la lista para siempre— porque el merge de `fields` es superficial.
 */
export type ImportConfigPatch = Partial<Omit<ImportConfig, 'fields'>> & {
  fields?: Record<string, FieldRule | null>;
  /** Volver al estado de fábrica y rehacer el asistente desde cero. Ignora el resto del patch. */
  reset?: true;
};

export class ImportConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Campos que no se pueden apagar ni desmapear (§3.1 inv. 3). */
const LOCKED = Object.entries(FIELD_CATALOG)
  .filter(([, d]) => d.locked)
  .map(([k]) => k);

export const DEFAULT_IMPORT_CONFIG: ImportConfig = {
  source: 'manual',
  profile: { kind: 'rows', headerRow: 1, recordStart: '' },
  fields: {},
  nameOrder: 'full',
  scope: { kind: 'account', ref: null },
  absentRule: 'set-current',
  carriesAssignee: false,
  askOnLogin: true,
};

/** Lee lo guardado rellenando lo que falte. Nunca explota: un JSONB viejo o a medias es normal. */
export function readImportConfig(raw: unknown): ImportConfig {
  const cfg = (raw ?? {}) as Partial<ImportConfig>;
  return {
    ...DEFAULT_IMPORT_CONFIG,
    ...cfg,
    profile: { ...DEFAULT_IMPORT_CONFIG.profile, ...cfg.profile },
    scope: { ...DEFAULT_IMPORT_CONFIG.scope, ...cfg.scope },
    fields: cfg.fields ?? {},
  };
}

/**
 * Valida los 7 invariantes de §3.1. Se corre en el `PATCH`, no sólo en la UI: la config viaja
 * a un JSONB sin esquema, y una regla contradictoria acá se convierte en una cartera mal
 * importada allá.
 */
export function validateImportConfig(next: ImportConfig, prev?: ImportConfig): void {
  if (!['manual', 'file'].includes(next.source)) {
    throw new ImportConfigError('INVALID_SOURCE', `source inválido: ${next.source}`);
  }
  if (!['pdf-blocks', 'rows'].includes(next.profile.kind)) {
    throw new ImportConfigError('INVALID_PROFILE_KIND', `Forma de archivo inválida: ${next.profile.kind}`);
  }

  // 6. El alcance 'account' cubre toda la cuenta y no lleva ref; los otros dos la exigen.
  if (next.scope.kind === 'account') {
    if (next.scope.ref) {
      throw new ImportConfigError('IMPORT_NOT_CONFIGURED', 'El alcance "empresa" no lleva referencia');
    }
  } else if (!next.scope.ref) {
    throw new ImportConfigError('IMPORT_NOT_CONFIGURED', 'Falta indicar la agencia u oficial del alcance');
  }

  const seen = new Map<string, string>();
  for (const [field, rule] of Object.entries(next.fields)) {
    if (!FIELD_CATALOG[field]) {
      throw new ImportConfigError('UNKNOWN_FIELD', `El campo "${field}" no existe en el catálogo`);
    }
    const enabled = rule.enabled !== false;

    // 1. "no importar" + "obligatorio" es contradictorio.
    if (!enabled && rule.required) {
      throw new ImportConfigError('FIELD_RULE_CONFLICT', `"${label(field)}" no puede ser obligatorio y no importarse`);
    }
    // 2. Obligar un campo sin decir de dónde sale reventaría el 100 % de las filas.
    if (rule.required && !rule.from) {
      throw new ImportConfigError('FIELD_NOT_MAPPED', `"${label(field)}" es obligatorio pero no está emparejado`);
    }
    // 3. La llave y el cliente no se apagan.
    if (LOCKED.includes(field) && !enabled) {
      throw new ImportConfigError('FIELD_RULE_CONFLICT', `"${label(field)}" no se puede apagar`);
    }
    // 5. Una misma columna no puede alimentar dos campos.
    if (rule.from && enabled) {
      const key = `${rule.in ?? 'header'}:${rule.from}`;
      const other = seen.get(key);
      if (other) {
        throw new ImportConfigError(
          'COLUMN_ALREADY_MAPPED',
          `"${rule.from}" ya está emparejada con "${label(other)}"`,
        );
      }
      seen.set(key, field);
    }
    // 7. `calibrated` es sólo de días de retraso, y confirmar es un acto aparte de elegir:
    // si se pudiera cambiar la columna y confirmarla en la misma llamada, "confirmado" no
    // significaría nada — el usuario nunca vio los valores nuevos.
    if (rule.calibrated !== undefined && field !== 'daysPastDue') {
      throw new ImportConfigError('FIELD_RULE_CONFLICT', 'Sólo los días de retraso se confirman');
    }
  }
  const nextDays = next.fields.daysPastDue;
  if (nextDays?.calibrated && prev && nextDays.from !== prev.fields.daysPastDue?.from) {
    throw new ImportConfigError('CALIBRATION_STALE', 'Elegí la columna y confirmala en dos pasos');
  }

  // 4. Cambiar la FORMA del archivo invalida todo emparejado: las etiquetas de un formato no
  // significan nada en el otro. El reset lo hace el caller, pero acá se avisa.
  if (prev && prev.profile.kind !== next.profile.kind && Object.keys(next.fields).length > 0) {
    const carried = Object.entries(next.fields).some(([f, r]) => r.from && r.from === prev.fields[f]?.from);
    if (carried) {
      throw new ImportConfigError('PROFILE_CHANGED', 'Al cambiar la forma del archivo hay que emparejar de nuevo');
    }
  }
}

/**
 * Aplica el patch de campos: merge superficial, y `null` = quitar (§3.1).
 *
 * La llave y el cliente no se quitan, por la misma razón por la que no se apagan (invariante 3):
 * sin `code` no hay con qué emparejar el archivo contra la cartera. Quitar es una forma más
 * definitiva de apagar, así que cae bajo la misma regla.
 */
export function mergeFieldPatch(
  prev: Record<string, FieldRule>,
  patch: Record<string, FieldRule | null> | undefined,
): Record<string, FieldRule> {
  if (!patch) return { ...prev };
  const out: Record<string, FieldRule> = { ...prev };
  for (const [field, rule] of Object.entries(patch)) {
    if (rule !== null) {
      out[field] = rule;
      continue;
    }
    if (LOCKED.includes(field)) {
      throw new ImportConfigError('FIELD_RULE_CONFLICT', `"${label(field)}" no se puede quitar`);
    }
    delete out[field];
  }
  return out;
}

/** `fields` listo para el motor: sólo los encendidos y emparejados. */
export function toFieldMap(fields: Record<string, FieldRule>): FieldMap {
  const out: FieldMap = {};
  for (const [field, rule] of Object.entries(fields)) {
    if (rule.enabled === false || !rule.from) continue;
    out[field] = { from: rule.from, in: rule.in };
  }
  return out;
}

/** Campos obligatorios: si uno viene vacío, la fila no se importa (`MISSING_<CAMPO>`). */
export function requiredFields(fields: Record<string, FieldRule>): string[] {
  return Object.entries(fields)
    .filter(([, r]) => r.required && r.enabled !== false)
    .map(([f]) => f);
}

/**
 * Qué es el archivo según sus bytes. `profile.kind` es una preferencia guardada; esto es un hecho,
 * y cuando se contradicen gana el archivo.
 *
 * Importa porque ningún parser falla al recibir lo que no es: el de planillas sobre un PDF
 * devuelve `%PDF-1.1` como si fuera la única columna, y sobre un xlsx devuelve los bytes del zip.
 * Un error claro es infinitamente mejor que una columna inventada.
 *
 * `text` = sin firma binaria; es lo que se ve en un CSV, y también en cualquier cosa que no
 * reconozcamos → se confía en lo configurado.
 */
export type FileShape = 'pdf' | 'zip' | 'text';

export function detectFileShape(file: Buffer | Uint8Array): FileShape {
  const head = Buffer.from(file.subarray(0, 4)).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK\x03\x04')) return 'zip'; // xlsx, ods y todo lo que empaqueta en zip
  return 'text';
}

/** Cómo se serializa el alcance en `client_import_runs.scope`. */
export function scopeLabel(scope: ImportConfig['scope']): string {
  return scope.kind === 'account' ? 'account' : `${scope.kind}:${scope.ref}`;
}

function label(field: string): string {
  return FIELD_CATALOG[field]?.label ?? field;
}
