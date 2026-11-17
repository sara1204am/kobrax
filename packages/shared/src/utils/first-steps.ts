/**
 * «Primeros pasos» de Inicio (F15 · P8, propuesta §3.3).
 *
 * Una lista corta de tareas **derivadas de datos reales** («ya tienes un cliente»), nunca de «vi la pantalla». Lo único que se
 * guarda es que la persona cerró la tarjeta a mano (`GuideState.firstStepsClosed`). Función pura: la web le pasa lo que ya
 * filtró (módulos visibles por plan ∧ permiso ∧ workspace) y los conteos que pidió a la API.
 *
 * R1 solo quita: un paso aparece únicamente si la persona tiene el permiso Y ve el módulo; nunca se sugiere lo que no puede hacer.
 */
import { Permission } from '../enums/permission.enum.js';
import type { WorkspaceNavKey } from './workspace.js';

export type FirstStepKey = 'createClient' | 'createCredit' | 'registerPayment';

interface FirstStepDef {
  key: FirstStepKey;
  /** Módulo del menú donde se hace. */
  module: WorkspaceNavKey;
  /** Permiso que hace falta para hacerlo. */
  permission: Permission;
  /** Ruta donde se empieza. */
  href: string;
  /** Qué conteo dice que ya está hecho. */
  counts: 'clients' | 'credits' | 'payments';
}

/** En el orden en que se hacen: sin cliente no hay crédito, y sin crédito no hay pago. */
export const FIRST_STEP_DEFS: readonly FirstStepDef[] = [
  {
    key: 'createClient',
    module: 'portfolio',
    permission: Permission.CLIENT_CREATE,
    href: '/cartera',
    counts: 'clients',
  },
  {
    key: 'createCredit',
    module: 'portfolio',
    permission: Permission.CREDIT_CREATE,
    href: '/cartera',
    counts: 'credits',
  },
  {
    key: 'registerPayment',
    module: 'payments',
    permission: Permission.PAYMENT_WRITE,
    href: '/pagos',
    counts: 'payments',
  },
];

export interface FirstStepsContext {
  /** Claves del menú que esta persona ve (plan ∧ permiso ∧ workspace). */
  visibleNavKeys: readonly WorkspaceNavKey[];
  /** Permisos de la persona. */
  permissions: readonly string[];
  /** Cuántos hay de cada cosa. Un conteo ausente = no se pudo leer. */
  counts: { clients?: number; credits?: number; payments?: number };
}

export interface FirstStep {
  key: FirstStepKey;
  href: string;
  done: boolean;
}

export interface FirstStepsView {
  steps: FirstStep[];
  /** Todas las tareas aplicables están hechas: la tarjeta se cierra sola. */
  complete: boolean;
}

/**
 * Las tareas que aplican a esta persona. Si no se pudo leer algún conteo, esa tarea no se ofrece (no se afirma lo que no se
 * sabe) y, sin tareas, la tarjeta no se muestra.
 */
export function firstSteps(ctx: FirstStepsContext): FirstStepsView {
  const granted = new Set(ctx.permissions);
  const visible = new Set<string>(ctx.visibleNavKeys);
  const steps: FirstStep[] = [];
  for (const def of FIRST_STEP_DEFS) {
    if (!visible.has(def.module) || !granted.has(def.permission)) continue;
    const n = ctx.counts[def.counts];
    if (typeof n !== 'number') continue;
    steps.push({ key: def.key, href: def.href, done: n > 0 });
  }
  return { steps, complete: steps.length > 0 && steps.every((s) => s.done) };
}
