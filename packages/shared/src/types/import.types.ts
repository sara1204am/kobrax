/**
 * Contrato del import de cartera (`/imports/portfolio`).
 *
 * Vive acá porque lo consumen el móvil y el panel web, y la API tiene su propia copia del lado
 * del servidor (`apps/api/src/modules/imports/`): son los mismos nombres a los dos lados del
 * cable. Acá NO hay nada de parseo — los clientes no leen archivos, los suben y dibujan lo que
 * la API les devuelve (D-PARSER).
 *
 * Ver `docs/epics/F10/plans/import/FIELD-RULES.md` §3 y §6.
 */

/** Las tres FORMAS de archivo. No son formatos ni bancos: es cómo está dispuesto el dato (C12). */
export type ProfileKind = 'pdf-blocks' | 'pdf-rows' | 'rows';

/** Qué hacer con los créditos que ya tenés y que el archivo NO trae. */
export type AbsentRule = 'set-current' | 'no-touch' | 'ask';

/** Cuánta cartera cubre el archivo — y por lo tanto hasta dónde llega el reconcile. */
export type ScopeKind = 'official' | 'branch' | 'account';

/** Cómo separar un nombre completo cuando la DB tiene apellido y nombre por separado. */
export type NameOrder = 'full' | 'surnames-first' | 'split-columns';

/** Regla por campo: de dónde sale y qué tan obligatorio es. */
export interface FieldRule {
  enabled?: boolean;
  required?: boolean;
  /** Etiqueta/encabezado EN EL ARCHIVO. Siempre editable, en todo formato. */
  from?: string;
  /** `table` = columna del cuadro (sólo `pdf-blocks`). Default `header`. */
  in?: 'header' | 'table' | 'below';
  /** Sólo `daysPastDue`: el usuario miró los valores y confirmó la columna. */
  calibrated?: boolean;
}

export interface ImportConfig {
  source: 'manual' | 'file';
  profile: {
    kind: ProfileKind;
    signature?: string[];
    recordStart?: string;
    tableAnchor?: string;
    headerRow?: number;
  };
  fields: Record<string, FieldRule>;
  nameOrder: NameOrder;
  scope: { kind: ScopeKind; ref: string | null };
  absentRule: AbsentRule;
  carriesAssignee: boolean;
  askOnLogin: boolean;
}

/**
 * Lo que viaja en un `PATCH`. Dos cosas que `Partial<ImportConfig>` no puede decir:
 * un campo en `null` se **quita** del emparejado, y `reset` devuelve todo al estado de fábrica.
 */
export type ImportConfigPatch = Partial<Omit<ImportConfig, 'fields'>> & {
  fields?: Record<string, FieldRule | null>;
  reset?: true;
};

/** Una entrada del catálogo canónico de campos. La etiqueta la manda el servidor. */
export interface FieldDef {
  label: string;
  type: 'text' | 'number' | 'int' | 'date';
  starred?: boolean;
  locked?: boolean;
}

/** La última corrida. La API guarda CONTEOS, no el detalle por fila. */
export interface LastRun {
  at: string;
  template: string | null;
  scope: string | null;
  created: number;
  updated: number;
  setCurrent: number;
  errors: number;
}

/** Candidatos de `scope.ref` — los devuelve el mismo GET de config. */
export interface ScopeMember {
  id: string;
  name: string;
  role: string;
}

export interface ScopeBranch {
  id: string;
  name: string;
}

/** Todo lo que la pantalla de Ajustes necesita para dibujarse, en una sola llamada. */
export interface ConfigScreen {
  config: ImportConfig;
  catalog: Record<string, FieldDef>;
  lastRun: LastRun | null;
  members: ScopeMember[];
  branches: ScopeBranch[];
}

/** Una columna que podría ser "días de atraso", con valores reales para calibrar. */
export interface ColumnCandidate {
  header: string;
  samples: { label: string; value: number | null }[];
}

/** Lo que devuelve `?columnsOnly=true`: qué trae el archivo, sin importar nada. */
export interface ColumnsPayload {
  labels: string[];
  columnCandidates: ColumnCandidate[];
  /**
   * Sólo en extractos PDF: textos que se repiten, del más frecuente al menos. Uno de ellos es el
   * que abre cada registro, y su cuenta es cuántos registros hay. Sin elegirlo, el archivo no se
   * puede cortar en créditos y no hay columnas que emparejar.
   */
  recordStartCandidates?: { text: string; count: number }[];
  /**
   * Sólo en tablas dentro de un PDF: las primeras filas del archivo, para que el usuario señale
   * cuál son los encabezados. Un reporte trae título, asesor y fecha antes de la tabla, y ninguna
   * regla general distingue eso de una fila de encabezados.
   */
  headerCandidates?: { anchor: string; preview: string }[];
}

/**
 * El resultado de una corrida (`dryRun` o real).
 *
 * **Tres baldes, no cuatro: «eliminados» no existe** — el reconcile nunca borra, y dibujar el
 * balde en cero sugeriría que podría.
 */
export interface PortfolioSummary {
  dryRun: boolean;
  idempotentSkip: boolean;
  counts: { created: number; updated: number; setCurrent: number; invalid: number };
  preview: {
    toCreate: { code: string; clientName: string }[];
    toUpdate: { code: string }[];
    toSetCurrent: { code: string | null }[];
    invalid: { index: number; reason: string }[];
    /** Advertencias que NO frenan la fila: se importa igual y se avisa. */
    warnings: { index?: number; code: string; detail?: string }[];
  };
}
