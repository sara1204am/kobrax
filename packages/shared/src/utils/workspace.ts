/**
 * Configurable Workspace (F15 · P1): qué módulos y opciones muestra una organización.
 *
 * Vive en `accounts.configuration.workspace` (jsonb que ya existía; sin migración). Función pura y sin dependencias de
 * la base: la usa la API (validar y servir), la web (menú, formularios) y, más adelante, el móvil.
 *
 * Reglas de fondo (plan F15 §5):
 *  - R1 el workspace SOLO QUITA: nunca añade nada a lo que el permiso y el plan ya permiten.
 *  - R2 la API no lo consulta para aceptar o rechazar operaciones: ocultar no es autorizar.
 *  - R3 nunca se borra ni se modifica un dato por ocultar algo.
 *  - R5 ausente = «Completo»: una cuenta que nunca lo configuró ve todo, igual que hoy.
 *  - R6 todo valor fijo lleva un default que el motor de créditos acepta (lo prueba `workspace.spec.ts`).
 *  - R7 una opción oculta nunca esconde un valor ya guardado: eso lo decide la pantalla con `shows`, no este módulo.
 */
import { CreditDefinition, OFFERED_FREQUENCIES, PaymentFrequency, TermUnit } from '../enums/credit.enum.js';

/** Versión del contrato. Un documento con una versión MAYOR se trata como «Completo» y no se modifica. */
export const WORKSPACE_VERSION = 1;
/** Tope del documento serializado, en BYTES UTF-8. Con el catálogo de la ola 1a el máximo real es de unos cientos. */
export const WORKSPACE_MAX_BYTES = 4096;
/** Topes de forma, comprobados ANTES de recorrer el documento: un cuerpo gigante se rechaza sin procesarlo. */
export const WORKSPACE_MAX_MODULES = 32;
export const WORKSPACE_MAX_OPTIONS = 64;

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

// ── Módulos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Los módulos del menú que una organización puede ocultar (ola 1a). */
export type WorkspaceModuleKey = 'routes' | 'team' | 'organization' | 'import' | 'export' | 'activity';

/** Clave de cada ítem del menú (`NAV` de la web, campo `label`). */
export type WorkspaceNavKey =
  | 'home'
  | 'portfolio'
  | 'import'
  | 'mora'
  | 'agenda'
  | 'routes'
  | 'payments'
  | 'export'
  | 'organization'
  | 'team'
  | 'accessSecurity'
  | 'activity'
  | 'account'
  | 'profile';

export interface WorkspaceModule {
  /** Clave del módulo = la del ítem del menú. */
  key: WorkspaceNavKey;
  /** Rutas del panel que pertenecen al módulo (prefijos). */
  routes: readonly string[];
  /** Módulos u opciones que deben seguir visibles para poder ocultar este (R8). Vacío en la ola 1a. */
  requires: readonly string[];
  /** Troncal: no se puede ocultar (D-5, D-8). */
  core: boolean;
}

/** El menú completo, en el orden del `NAV` de la web. Los `core` son troncales. */
export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [
  { key: 'home', routes: ['/dashboard'], requires: [], core: true },
  { key: 'portfolio', routes: ['/cartera'], requires: [], core: true },
  { key: 'import', routes: ['/import'], requires: [], core: false },
  { key: 'mora', routes: ['/mora'], requires: [], core: true },
  { key: 'agenda', routes: ['/agenda'], requires: [], core: true },
  { key: 'routes', routes: ['/rutas'], requires: [], core: false },
  { key: 'payments', routes: ['/pagos'], requires: [], core: true },
  { key: 'export', routes: ['/exportar'], requires: [], core: false },
  { key: 'organization', routes: ['/organizacion'], requires: [], core: false },
  { key: 'team', routes: ['/equipo'], requires: [], core: false },
  { key: 'accessSecurity', routes: ['/seguridad'], requires: [], core: true },
  { key: 'activity', routes: ['/actividad'], requires: [], core: false },
  { key: 'account', routes: ['/cuenta'], requires: [], core: true },
  { key: 'profile', routes: ['/settings'], requires: [], core: true },
];

/** Los que se pueden ocultar, en el orden del menú. */
export const HIDEABLE_MODULES: readonly WorkspaceModuleKey[] = WORKSPACE_MODULES.filter((m) => !m.core).map(
  (m) => m.key as WorkspaceModuleKey,
);

// ── Opciones ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type WorkspaceOptionKey =
  | 'credit.definition'
  | 'credit.advanced'
  | 'credit.arrearsMethod'
  | 'credit.frequencies'
  | 'client.income'
  | 'client.guarantors'
  | 'client.collateral'
  | 'client.attachments'
  | 'client.gender'
  | 'client.preferredChannel'
  | 'client.taxId';

/** `section`/`field`: `false` la oculta. `fixed`: un valor fijo. `choices`: la lista de valores que se ofrecen. */
export type WorkspaceOptionKind = 'section' | 'field' | 'fixed' | 'choices';

export interface WorkspaceOption {
  key: WorkspaceOptionKey;
  module: 'portfolio';
  kind: WorkspaceOptionKind;
  /** S = solo presentación; D = con un valor por defecto explícito que el motor acepta. Las P (no ocultar) no tienen entrada. */
  risk: 'S' | 'D';
  /** Valores permitidos de un `fixed` o de un `choices`. */
  values?: readonly string[];
  /** Módulos u opciones que deben seguir visibles para poder usar esta (R8). */
  requires: readonly string[];
}

export const WORKSPACE_OPTIONS: readonly WorkspaceOption[] = [
  { key: 'credit.definition', module: 'portfolio', kind: 'fixed', risk: 'D', values: Object.values(CreditDefinition), requires: [] },
  { key: 'credit.advanced', module: 'portfolio', kind: 'section', risk: 'S', requires: [] },
  { key: 'credit.arrearsMethod', module: 'portfolio', kind: 'field', risk: 'S', requires: [] },
  { key: 'credit.frequencies', module: 'portfolio', kind: 'choices', risk: 'D', values: OFFERED_FREQUENCIES as readonly string[], requires: [] },
  { key: 'client.income', module: 'portfolio', kind: 'section', risk: 'S', requires: [] },
  { key: 'client.guarantors', module: 'portfolio', kind: 'section', risk: 'S', requires: [] },
  { key: 'client.collateral', module: 'portfolio', kind: 'section', risk: 'S', requires: [] },
  { key: 'client.attachments', module: 'portfolio', kind: 'section', risk: 'S', requires: [] },
  { key: 'client.gender', module: 'portfolio', kind: 'field', risk: 'S', requires: [] },
  { key: 'client.preferredChannel', module: 'portfolio', kind: 'field', risk: 'S', requires: [] },
  { key: 'client.taxId', module: 'portfolio', kind: 'field', risk: 'S', requires: [] },
];

export type WorkspaceOptionValue = boolean | string | string[];

// ── El documento ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Workspace {
  /** Versión del contrato. */
  version: number;
  /** Control optimista: el guardado envía el `rev` que leyó y el servidor lo incrementa. */
  rev: number;
  /** Módulos ocultos (no deshabilitados: «ocultar no es autorizar»). */
  hiddenModules: WorkspaceModuleKey[];
  /** `false` = oculta; `string` = valor fijo; `string[]` = lista permitida. Ausente = visible. */
  options: Partial<Record<WorkspaceOptionKey, WorkspaceOptionValue>>;
}

/** «Completo»: nada oculto. Es lo que ve toda cuenta que nunca configuró el workspace (R5). */
export function emptyWorkspace(): Workspace {
  return { version: WORKSPACE_VERSION, rev: 0, hiddenModules: [], options: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const OPTION_BY_KEY = new Map<string, WorkspaceOption>(WORKSPACE_OPTIONS.map((o) => [o.key, o]));
const MODULE_BY_KEY = new Map<string, WorkspaceModule>(WORKSPACE_MODULES.map((m) => [m.key, m]));

/** ¿Este valor es válido para esa opción? Compartido por la lectura tolerante y la escritura estricta. */
function optionValueError(opt: WorkspaceOption, value: unknown): 'OPTION_VALUE' | 'CHOICES_EMPTY' | null {
  switch (opt.kind) {
    case 'section':
    case 'field':
      // Solo `false` tiene sentido: «visible» es la ausencia de la clave.
      return value === false ? null : 'OPTION_VALUE';
    case 'fixed':
      return typeof value === 'string' && (opt.values ?? []).includes(value) ? null : 'OPTION_VALUE';
    case 'choices': {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && (opt.values ?? []).includes(v))) return 'OPTION_VALUE';
      return value.length === 0 ? 'CHOICES_EMPTY' : null;
    }
  }
}

/** La versión guardada, o `null` si no hay documento. */
export function workspaceVersionOf(configuration: unknown): number | null {
  const raw = isRecord(configuration) ? configuration.workspace : undefined;
  if (!isRecord(raw)) return null;
  return typeof raw.version === 'number' && Number.isInteger(raw.version) ? raw.version : null;
}

/**
 * El workspace de una cuenta a partir de su `configuration` tal como está en la base. **Tolerante**: nunca lanza.
 * Lo ausente o malformado cae a «Completo»; las claves que no conoce se ignoran; una versión mayor que la conocida se
 * trata como «Completo» (otra versión del producto escribió algo que esta no sabe leer, y no se debe adivinar).
 */
export function parseWorkspace(configuration: unknown): Workspace {
  const raw = isRecord(configuration) ? configuration.workspace : undefined;
  if (!isRecord(raw)) return emptyWorkspace();
  const version = typeof raw.version === 'number' && Number.isInteger(raw.version) ? raw.version : WORKSPACE_VERSION;
  if (version > WORKSPACE_VERSION) return emptyWorkspace();
  const rev = typeof raw.rev === 'number' && Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;

  const hidden = new Set<string>(Array.isArray(raw.hiddenModules) ? raw.hiddenModules.filter((k): k is string => typeof k === 'string') : []);
  const hiddenModules = HIDEABLE_MODULES.filter((k) => hidden.has(k));

  const options: Workspace['options'] = {};
  if (isRecord(raw.options)) {
    for (const opt of WORKSPACE_OPTIONS) {
      const v = raw.options[opt.key];
      if (v !== undefined && optionValueError(opt, v) === null) options[opt.key] = v as WorkspaceOptionValue;
    }
  }
  return { version: WORKSPACE_VERSION, rev, hiddenModules, options };
}

// ── Escritura estricta ───────────────────────────────────────────────────────────────────────────────────────────────

export type WorkspaceErrorCode =
  | 'SHAPE'
  | 'VERSION'
  | 'MODULE_UNKNOWN'
  | 'MODULE_CORE'
  | 'OPTION_UNKNOWN'
  | 'OPTION_VALUE'
  | 'CHOICES_EMPTY'
  | 'REQUIRES'
  | 'TOO_LARGE';

export interface WorkspaceError {
  code: WorkspaceErrorCode;
  /** El módulo u opción a la que se refiere, si la hay. */
  key?: string;
}

export type WorkspaceValidation = { ok: true; workspace: Workspace } | { ok: false; errors: WorkspaceError[] };

export interface WorkspaceCatalog {
  modules: readonly WorkspaceModule[];
  options: readonly WorkspaceOption[];
}

const DEFAULT_CATALOG: WorkspaceCatalog = { modules: WORKSPACE_MODULES, options: WORKSPACE_OPTIONS };

/**
 * Valida un documento que alguien quiere GUARDAR. **Estricto**: cualquier cosa fuera del contrato es un error con su
 * código; no se ignora en silencio. El `rev` lo comprueba el servidor contra lo guardado (aquí solo se exige que sea un
 * entero ≥ 0). Devuelve el documento ya normalizado (módulos en el orden del menú, sin repetidos).
 */
export function validateWorkspaceInput(input: unknown, catalog: WorkspaceCatalog = DEFAULT_CATALOG): WorkspaceValidation {
  const errors: WorkspaceError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [{ code: 'SHAPE' }] };

  if (input.version !== WORKSPACE_VERSION) errors.push({ code: 'VERSION' });
  if (typeof input.rev !== 'number' || !Number.isInteger(input.rev) || input.rev < 0) errors.push({ code: 'SHAPE', key: 'rev' });
  if (!Array.isArray(input.hiddenModules) || !input.hiddenModules.every((k) => typeof k === 'string')) errors.push({ code: 'SHAPE', key: 'hiddenModules' });
  if (!isRecord(input.options)) errors.push({ code: 'SHAPE', key: 'options' });
  if (errors.length > 0) return { ok: false, errors };
  if ((input.hiddenModules as unknown[]).length > WORKSPACE_MAX_MODULES || Object.keys(input.options as object).length > WORKSPACE_MAX_OPTIONS) {
    return { ok: false, errors: [{ code: 'TOO_LARGE' }] };
  }

  const modules = new Map(catalog.modules.map((m) => [m.key as string, m]));
  const options = new Map(catalog.options.map((o) => [o.key as string, o]));

  const hiddenSet = new Set<string>();
  for (const key of input.hiddenModules as string[]) {
    const mod = modules.get(key);
    if (!mod) errors.push({ code: 'MODULE_UNKNOWN', key });
    else if (mod.core) errors.push({ code: 'MODULE_CORE', key });
    else hiddenSet.add(key);
  }

  const cleanOptions: Workspace['options'] = {};
  for (const [key, value] of Object.entries(input.options as Record<string, unknown>)) {
    const opt = options.get(key);
    if (!opt) {
      errors.push({ code: 'OPTION_UNKNOWN', key });
      continue;
    }
    const bad = optionValueError(opt, value);
    if (bad) errors.push({ code: bad, key });
    else cleanOptions[opt.key] = Array.isArray(value) ? [...new Set(value as string[])] : (value as WorkspaceOptionValue);
  }

  // R8: una opción activa solo puede apoyarse en lo que sigue visible.
  for (const key of Object.keys(cleanOptions)) {
    for (const dep of options.get(key)?.requires ?? []) {
      if (hiddenSet.has(dep) || cleanOptions[dep as WorkspaceOptionKey] === false) errors.push({ code: 'REQUIRES', key });
    }
  }
  for (const key of hiddenSet) {
    for (const dep of modules.get(key)?.requires ?? []) {
      if (hiddenSet.has(dep) || cleanOptions[dep as WorkspaceOptionKey] === false) errors.push({ code: 'REQUIRES', key });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const workspace: Workspace = {
    version: WORKSPACE_VERSION,
    rev: input.rev as number,
    hiddenModules: catalog.modules.filter((m) => hiddenSet.has(m.key)).map((m) => m.key as WorkspaceModuleKey),
    options: cleanOptions,
  };
  if (byteLength(JSON.stringify(workspace)) > WORKSPACE_MAX_BYTES) return { ok: false, errors: [{ code: 'TOO_LARGE' }] };
  return { ok: true, workspace };
}

// ── Lectura para las pantallas ───────────────────────────────────────────────────────────────────────────────────────

export interface ResolvedWorkspace {
  /** ¿Se muestra este módulo? Un troncal siempre. */
  showsModule(key: WorkspaceNavKey): boolean;
  /** Las claves del menú que se muestran, en el orden del menú. */
  visibleNavKeys(): WorkspaceNavKey[];
  /** El módulo oculto al que pertenece una ruta del panel, o `null` si esa ruta se puede abrir. */
  hiddenModuleOfPath(pathname: string): WorkspaceModuleKey | null;
  /** ¿Se muestra esta sección o este campo? `false` solo si se ocultó. */
  shows(key: WorkspaceOptionKey): boolean;
  /** El valor fijo de una opción `fixed`, o `undefined`. */
  fixed(key: WorkspaceOptionKey): string | undefined;
  /** La lista permitida de una opción `choices`, o `undefined` si no hay restricción. */
  choices(key: WorkspaceOptionKey): string[] | undefined;
  /** Lo que el alta de un crédito pone por quien no ve el campo (ver `workspaceDefaults`). */
  creditDefaults(): WorkspaceCreditDefaults;
}

/**
 * Lo que una pantalla necesita saber del workspace. `ctx.planCode` está reservado para el gancho `planGate` (D-7: sin
 * bloqueo comercial por módulo): hoy no cambia nada.
 */
export function resolveWorkspace(workspace: Workspace, _ctx: { planCode?: string } = {}): ResolvedWorkspace {
  const hidden = new Set<string>(workspace.hiddenModules);
  const showsModule = (key: WorkspaceNavKey): boolean => !hidden.has(key) || MODULE_BY_KEY.get(key)?.core === true;
  return {
    showsModule,
    visibleNavKeys: () => WORKSPACE_MODULES.filter((m) => showsModule(m.key)).map((m) => m.key),
    hiddenModuleOfPath(pathname) {
      for (const m of WORKSPACE_MODULES) {
        if (m.core || !hidden.has(m.key)) continue;
        if (m.routes.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return m.key as WorkspaceModuleKey;
      }
      return null;
    },
    shows: (key) => workspace.options[key] !== false,
    fixed(key) {
      const v = workspace.options[key];
      return OPTION_BY_KEY.get(key)?.kind === 'fixed' && typeof v === 'string' ? v : undefined;
    },
    choices(key) {
      const v = workspace.options[key];
      return OPTION_BY_KEY.get(key)?.kind === 'choices' && Array.isArray(v) ? [...v] : undefined;
    },
    creditDefaults: () => workspaceDefaults(workspace),
  };
}

// ── Valores por defecto de lo que se oculta ──────────────────────────────────────────────────────────────────────────

/** Lo que el formulario del crédito debe poner por quien no ve el campo (R6). Todo es opcional. */
export interface WorkspaceCreditDefaults {
  /** La modalidad fija. */
  definition?: CreditDefinition;
  /** Con una modalidad de cuota o total acordado el plazo se cuenta en cuotas: el valor inicial `years` convertiría «12» en 12 años (C-3). */
  termUnit?: TermUnit;
  /** Si la lista de frecuencias permitidas no incluye la inicial del formulario (mensual), la primera permitida. */
  frequency?: PaymentFrequency;
}

/**
 * El payload que antes pedía el campo oculto, para que el formulario nunca envíe vacío algo que el motor exige.
 * **Nunca sobrescribe un valor existente**: lo usa el alta, no la edición de un crédito que ya tiene su modalidad (R7).
 */
export function workspaceDefaults(workspace: Workspace): WorkspaceCreditDefaults {
  const out: WorkspaceCreditDefaults = {};
  // La frecuencia inicial del formulario es mensual: si la organización no la permite, arranca en la primera que sí.
  const allowed = workspace.options['credit.frequencies'];
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(PaymentFrequency.MONTHLY)) {
    // La primera de las que la app ofrece (en su orden) y la organización permite: no «la primera de la lista guardada».
    const first = OFFERED_FREQUENCIES.find((f) => allowed.includes(f));
    if (first) out.frequency = first;
  }
  const fixed = workspace.options['credit.definition'];
  if (typeof fixed !== 'string') return out;
  const definition = fixed as CreditDefinition;
  // Una tabla por modalidad (y no un `else` genérico): al añadir una modalidad nueva el compilador obliga a decidir su plazo.
  const unit: Record<CreditDefinition, TermUnit | undefined> = {
    [CreditDefinition.CALCULATED]: undefined,
    [CreditDefinition.AGREED_INSTALLMENT]: TermUnit.INSTALLMENTS,
    [CreditDefinition.AGREED_TOTAL]: TermUnit.INSTALLMENTS,
  };
  const termUnit = unit[definition];
  return termUnit ? { ...out, definition, termUnit } : { ...out, definition };
}
