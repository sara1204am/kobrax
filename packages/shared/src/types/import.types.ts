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
  /** Qué representa el saldo de este formato (D6). Ausente = no se sabe. */
  balanceBasis?: 'principal' | 'total';
  /** Etiqueta de estado del reporte (MAYÚSCULAS, sin tildes) → estado del crédito. */
  statusMap?: Record<string, string>;
  /** Días desde la fecha de corte tras los que el dato se marca desactualizado (D9). Ausente = 2. */
  staleAfterDays?: number;
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
  /** Fecha de corte del último reporte aplicado (YYYY-MM-DD) y de qué asesor era (D8, D9). */
  reportDate?: string | null;
  advisorCode?: string | null;
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
/**
 * Qué puede hacer en la importación quien la está mirando. Lo decide el servidor —las pantallas no
 * deducen permisos del rol— y viaja con la configuración para no dibujar controles que van a fallar.
 */
export interface ImportViewer {
  userId: string;
  /** `assignment:write`: elige el responsable de los créditos nuevos y puede reasignar existentes. */
  canAssign: boolean;
  /** Cambia la configuración y los vínculos de asesor: `assignment:write` o dueño de la cuenta (P1). */
  canConfigure: boolean;
}

export interface ConfigScreen {
  config: ImportConfig;
  catalog: Record<string, FieldDef>;
  lastRun: LastRun | null;
  members: ScopeMember[];
  branches: ScopeBranch[];
  viewer: ImportViewer;
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
   * Los primeros valores reales de cada etiqueta — **lo que el motor leería si se emparejara ahí**,
   * leído con el mismo `readField` que usa la corrida, así que el ejemplo no puede diferir de lo
   * que después se importa.
   *
   * Sin esto se empareja a ciegas: el archivo ofrece «SALDO» y «SALDO CAPITAL» y nada dice cuál es
   * cuál hasta que la cartera entró mal. `columnCandidates` no alcanza — sólo trae las columnas
   * que parecen días de atraso.
   */
  samples?: Record<string, string[]>;
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
 * Quién queda responsable de lo que trae un reporte, como lo manda la pantalla al CONFIRMAR
 * (campo `assignments` del multipart, en JSON).
 *
 * 🔴 **Todo por nº de operación, nunca por posición.** El archivo se vuelve a leer al confirmar y el
 * servidor recalcula el plan: una fila que en la vista previa era la 7 puede no serlo.
 */
export interface ImportAssignments {
  version: 1;
  /** Créditos NUEVOS agrupados por responsable elegido. Los que no figuran toman la sugerencia. */
  create?: { userId: string; externalIds: string[] }[];
  /**
   * Reasignaciones EXPLÍCITAS de créditos que ya existían. `fromUserId` es el responsable que se
   * vio en la vista previa: si cambió mientras tanto, se rechaza (ASSIGNMENT_CONFLICT).
   */
  reassign?: { externalId: string; fromUserId: string | null; toUserId: string }[];
}

/** De dónde sale el responsable sugerido de un crédito nuevo. */
export type AssigneeSuggestionSource = 'ADVISOR' | 'SCOPE' | 'SELF';

/** Una asignación pedida que no se aplicó, y por qué. No frena la corrida: se informa. */
export interface ImportAssignmentNote {
  externalId: string;
  /** NOW_EXISTING: era nuevo en la vista previa y al confirmar ya existía (otra importación). */
  reason: 'NOW_EXISTING' | 'UNKNOWN_CODE' | 'NOT_UPDATED';
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
  counts: {
    created: number;
    updated: number;
    setCurrent: number;
    invalid: number;
    /** Operaciones que faltan del reporte por primera vez (D4). Ausentes en respuestas viejas. */
    absent?: number;
    /** Operaciones que faltaban y volvieron. */
    reappeared?: number;
    /** Clientes nuevos que quedan marcados «Revisar vínculo» (D2). */
    needsReview?: number;
    /** Filas que no son registros: totales y notas debajo de la tabla. */
    ignored?: number;
  };
  /** De qué fecha de corte y de qué asesor es el reporte, y a qué alcance se aplica (D8, D9). */
  report?: { reportDate: string | null; advisorCode: string | null; scope: string };
  /**
   * El tope de créditos del plan, contra lo que este archivo quiere crear.
   *
   * 🔴 Va en la **vista previa** y no en el error del final: un archivo que se pasa se rechaza
   * entero (LIMITES §5.2, Pregunta 10), y enterarse recién al confirmar es la peor forma de
   * descubrirlo. Ausente = el plan no tiene tope de créditos.
   */
  plan?: {
    /** Cuántos créditos más entran hoy. */
    roomLeft: number;
    /** Por cuántos se pasa el archivo. `0` = entra. */
    over: number;
  };
  /**
   * Cómo se decide el responsable en ESTA corrida, según quién importa:
   * - `SELF`: no tiene `assignment:write` (el cobrador). Los nuevos quedan a su nombre; no elige.
   * - `CHOOSE`: reparte. Los nuevos llegan con una sugerencia y no se confirma si queda alguno sin.
   */
  assignment?: { mode: 'SELF' | 'CHOOSE'; selfUserId: string };
  /**
   * Este mismo archivo ya se aplicó (P6). La vista previa lo avisa y no deja confirmar ni repartir:
   * confirmar de nuevo no hace nada, y reasignar con un archivo viejo se hace desde Cartera.
   */
  alreadyApplied?: { runId: string; at: string; by: string | null };
  /** Sólo al confirmar: cuántos nuevos quedaron con cada responsable y cuántos existentes se reasignaron. */
  assigned?: { userId: string; count: number }[];
  reassigned?: number;
  /** Asignaciones pedidas que no se aplicaron (por ejemplo, un nuevo que ya existía al confirmar). */
  assignmentNotes?: ImportAssignmentNote[];
  preview: {
    /**
     * Cada balde dice **quién** es y con qué números, no sólo el nº de operación: «302-222-1515» no le
     * dice nada a quien confirma. `before` es cómo está hoy en Kobrax; `after`, lo que trae el reporte.
     * Los campos nuevos son opcionales: una API vieja los omite y la pantalla muestra el código.
     */
    toCreate: {
      code: string;
      clientName: string;
      existingClient?: boolean;
      linkReview?: boolean;
      after?: ImportItemValues;
      /** Responsable sugerido (el usuario del asesor del reporte, o el del alcance). `null` = nadie. */
      suggestedAssigneeId?: string | null;
      suggestionSource?: AssigneeSuggestionSource;
    }[];
    toUpdate: {
      code: string;
      reappeared?: boolean;
      clientName?: string;
      before?: ImportItemValues;
      after?: ImportItemValues;
      /** Responsable de hoy. La importación NO lo cambia; sólo una reasignación explícita. */
      currentAssigneeId?: string | null;
    }[];
    toSetCurrent: { code: string | null; clientName?: string; before?: ImportItemValues }[];
    /** Operaciones que dejan de venir en el reporte (D4): no es un pago ni un cierre. */
    toMarkAbsent?: { code: string | null; clientName?: string; before?: ImportItemValues }[];
    invalid: { index: number; reason: string; code?: string; clientName?: string }[];
    /** Advertencias que NO frenan la fila: se importa igual y se avisa. */
    warnings: { index?: number; code: string; detail?: string }[];
  };
}

// ── Historial de importaciones de cartera ────────────────────────────────────

/** Qué le pasó a un registro en una corrida. */
export const IMPORT_RUN_ITEM_ACTIONS = ['CREATED', 'UPDATED', 'REAPPEARED', 'SET_CURRENT', 'ABSENT', 'REJECTED'] as const;
export type ImportRunItemAction = (typeof IMPORT_RUN_ITEM_ACTIONS)[number];

/** Cuántos registros hubo de cada cosa en una corrida. */
export interface ImportRunCounts {
  created: number;
  /** Ya existían y vinieron en el reporte. **No** incluye las reaparecidas, que van aparte. */
  updated: number;
  reappeared: number;
  /** Faltaron del reporte y, con la regla «al día», su mora quedó en 0. Siempre son ausentes también. */
  setCurrent: number;
  /** Faltaron del reporte por primera vez (D4): no es «pagó» ni «al día». */
  absent: number;
  /** Filas del archivo que no se pudieron importar. */
  rejected: number;
  /** Filas que no eran registros (totales, notas): no se cuentan como error. */
  ignored: number;
  /** Clientes nuevos que quedaron para «Revisar vínculo» (D2). */
  needsReview: number;
}

/** Una corrida del historial (`GET /imports/portfolio/runs`). */
export interface ImportRunSummary {
  id: string;
  at: string;
  /** Quién importó: nombre y correo. Ausente si el usuario ya no existe. */
  createdBy?: { id: string; name: string };
  template: string | null;
  scope: string | null;
  externalSource: string | null;
  reportDate: string | null;
  advisorCode: string | null;
  counts: ImportRunCounts;
  /** El documento que se subió. Ausente = corrida anterior a que se guardara. */
  file?: { name: string; size: number; mimeType: string };
  /** `false` = corrida anterior al historial: sin el detalle de «al día» ni de rechazadas. */
  itemsComplete: boolean;
}

/** Saldo, mora y estado de una operación, antes o después de la corrida. */
export interface ImportItemValues {
  outstandingBalance?: number | null;
  daysPastDue?: number | null;
  status?: string | null;
  /** Estado tal como lo escribió el reporte («VIGENTE», «Vencida»…). */
  reportedStatus?: string | null;
  /** Sólo en las nuevas: si se creó el cliente o se sumó a uno existente, y si quedó a revisar. */
  newClient?: boolean;
  linkReview?: boolean;
}

/** Un movimiento de la corrida (`GET /imports/portfolio/runs/:id/items`). */
export interface ImportRunItem {
  id: string;
  action: ImportRunItemAction;
  creditId?: string;
  clientId?: string;
  externalId?: string;
  clientName?: string;
  /** Nº de registro en el archivo (1 = el primero). */
  rowNumber?: number;
  /** Por qué se rechazó (`MISSING_CODE`, `MATCHES_OUT_OF_SCOPE`…). */
  reason?: string;
  before?: ImportItemValues;
  after?: ImportItemValues;
}
