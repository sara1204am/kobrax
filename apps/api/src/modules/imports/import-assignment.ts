/**
 * Quién queda responsable de lo que trae un reporte (puro, testeable sin DB).
 *
 * Tres preguntas, en este orden:
 *  1. `parseImportAssignments` — ¿lo que mandó la pantalla tiene forma? (al confirmar)
 *  2. `resolveImportOwnership` — ¿de quién es esta cartera, y puede importarla quien la sube?
 *  3. `planAssignments` — el responsable final de cada nuevo y las reasignaciones de existentes.
 *
 * Las asignaciones se escriben después con `AssignmentService` (tabla + columna): acá sólo se decide.
 */
import type { AssigneeSuggestionSource, ImportAssignmentNote, ImportAssignments, ImportConfig } from '@kobrax/shared';
import type { AssignmentReason } from '../assignments/assignment-rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Topes: un reporte real trae cientos o pocos miles; esto frena un cuerpo armado para tumbar el server. */
const MAX_CODES = 5000;
const MAX_GROUPS = 200;

export class ImportAssignmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const invalid = (message: string) => new ImportAssignmentError('INVALID_ASSIGNMENTS', message);

/**
 * El campo `assignments` del multipart. Ausente o vacío = no se eligió nada (la vista previa, o el
 * cobrador). Se valida a mano y no con un DTO porque llega como texto dentro de un multipart.
 */
export function parseImportAssignments(raw: unknown): ImportAssignments | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let value: unknown;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw invalid('Las asignaciones no son un JSON válido');
  }
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
    throw invalid('Formato de asignaciones desconocido');
  }
  const { create = [], reassign = [] } = value as { create?: unknown; reassign?: unknown };
  if (!Array.isArray(create) || !Array.isArray(reassign)) throw invalid('Las asignaciones deben ser listas');
  if (create.length > MAX_GROUPS) throw invalid('Demasiados grupos de asignación');

  const seen = new Set<string>();
  const once = (code: unknown): string => {
    if (typeof code !== 'string' || !code.trim()) throw invalid('Nº de operación vacío');
    const c = code.trim();
    // Un mismo crédito en dos grupos —o nuevo y reasignado a la vez— no tiene una lectura correcta.
    if (seen.has(c)) throw invalid(`El nº de operación ${c} figura dos veces`);
    seen.add(c);
    if (seen.size > MAX_CODES) throw invalid('Demasiados créditos en las asignaciones');
    return c;
  };
  const user = (id: unknown, nullable = false): string | null => {
    if (nullable && id === null) return null;
    if (typeof id !== 'string' || !UUID.test(id)) throw invalid('Usuario inválido en las asignaciones');
    return id;
  };

  return {
    version: 1,
    create: create.map((g: unknown) => {
      const group = g as { userId?: unknown; externalIds?: unknown };
      if (!Array.isArray(group?.externalIds)) throw invalid('Grupo sin créditos');
      return { userId: user(group.userId)!, externalIds: group.externalIds.map(once) };
    }),
    reassign: reassign.map((r: unknown) => {
      const row = r as { externalId?: unknown; fromUserId?: unknown; toUserId?: unknown };
      return { externalId: once(row?.externalId), fromUserId: user(row?.fromUserId ?? null, true), toUserId: user(row?.toUserId)! };
    }),
  };
}

export function hasAssignments(a: ImportAssignments | null): boolean {
  return !!a && ((a.create?.some((g) => g.externalIds.length > 0) ?? false) || (a.reassign?.length ?? 0) > 0);
}

/** El resultado de mirar de quién es el reporte. */
export interface Ownership {
  /** El alcance efectivo de la corrida: qué puede quedar ausente. */
  scope: ImportConfig['scope'];
  /** El responsable sugerido para los nuevos, y de dónde sale. `null` = nadie. */
  suggested: { userId: string; source: AssigneeSuggestionSource } | null;
  mode: 'SELF' | 'CHOOSE';
}

/**
 * ¿De quién es esta cartera, y puede importarla quien la sube?
 *
 * - **Quien reparte** (`assignment:write`): lo de antes (D8). Con asesor vinculado, el alcance es
 *   ese usuario y es la sugerencia; sin vínculo y alcance «empresa», se frena (ADVISOR_NOT_LINKED).
 * - **Quien no reparte** (el cobrador): sólo su propia cartera.
 *     · asesor vinculado a él → su cartera;
 *     · asesor vinculado a OTRO → ADVISOR_BELONGS_TO_OTHER (no se apropia de la cartera ajena);
 *     · asesor sin vínculo → ADVISOR_NOT_LINKED (P1b: vincularlo es de quien configura);
 *     · sin asesor → su cartera, sin importar el alcance configurado (P2): así lo que falte del
 *       archivo sólo puede quedar ausente dentro de lo suyo.
 */
export function resolveImportOwnership(input: {
  canAssign: boolean;
  me: string;
  advisorCode: string | null | undefined;
  /** El usuario vinculado al código de asesor, si lo hay. */
  linkedUserId: string | null;
  configScope: ImportConfig['scope'];
}): Ownership {
  const { canAssign, me, advisorCode, linkedUserId, configScope } = input;

  if (!canAssign) {
    if (advisorCode && linkedUserId && linkedUserId !== me) {
      throw new ImportAssignmentError('ADVISOR_BELONGS_TO_OTHER', `El reporte es del asesor ${advisorCode}, que es la cartera de otra persona.`, {
        advisorCode,
        userId: linkedUserId,
      });
    }
    if (advisorCode && !linkedUserId) {
      throw new ImportAssignmentError(
        'ADVISOR_NOT_LINKED',
        `El reporte es del asesor ${advisorCode}, que no está vinculado a ningún usuario. Pedile a quien administra la importación que lo vincule en Ajustes › Importación › Asesores.`,
        { advisorCode },
      );
    }
    return { scope: { kind: 'official', ref: me }, suggested: { userId: me, source: 'SELF' }, mode: 'SELF' };
  }

  if (advisorCode && linkedUserId) {
    return { scope: { kind: 'official', ref: linkedUserId }, suggested: { userId: linkedUserId, source: 'ADVISOR' }, mode: 'CHOOSE' };
  }
  if (advisorCode && configScope.kind === 'account') {
    throw new ImportAssignmentError(
      'ADVISOR_NOT_LINKED',
      `El reporte es del asesor ${advisorCode}, que no está vinculado a ningún usuario. Vinculalo en Ajustes › Importación › Asesores para que sus operaciones no se crucen con las de los demás.`,
      { advisorCode },
    );
  }
  const scopeUser = configScope.kind === 'official' ? configScope.ref : null;
  return { scope: configScope, suggested: scopeUser ? { userId: scopeUser, source: 'SCOPE' } : null, mode: 'CHOOSE' };
}

/** El responsable final de un nuevo, con el motivo que va a la auditoría. */
export interface PlannedAssignment {
  userId: string;
  reason: AssignmentReason;
}

export interface AssignmentPlan {
  /** Nº de operación nuevo → responsable. Al confirmar, TODOS los nuevos tienen uno. */
  create: Map<string, PlannedAssignment>;
  /** Nuevos que quedaron sin responsable (sólo en modo CHOOSE). Confirmar con alguno = error. */
  unassigned: string[];
  /** Reasignaciones de existentes que sí aplican. */
  reassign: { code: string; from: string | null; to: string }[];
  /** Pedidos que no aplican, para informar. */
  notes: ImportAssignmentNote[];
  /** Destinatarios elegidos que no se pueden asignar (P3). */
  notAssignable: string[];
}

/**
 * El reparto final, con lo que el servidor sabe AL CONFIRMAR (el plan recalculado), no con lo que
 * vio la pantalla. Lo que la pantalla pidió y ya no corresponde se informa en `notes` y no se aplica.
 *
 * Una sugerencia que no es asignable (el asesor vinculado a un gerente que no es quien importa) no
 * cuenta: el nuevo queda sin responsable y la pantalla pide elegir, en vez de rebotar al guardar.
 */
export function planAssignments(input: {
  mode: 'SELF' | 'CHOOSE';
  me: string;
  toCreate: string[];
  /** Existentes en esta corrida → su responsable de hoy. */
  toUpdate: Map<string, string | null>;
  suggested: Ownership['suggested'];
  /** Quiénes pueden recibir créditos (P3). */
  assignable: Set<string>;
  requested: ImportAssignments | null;
}): AssignmentPlan {
  const { mode, me, toCreate, toUpdate, suggested, assignable, requested } = input;
  const plan: AssignmentPlan = { create: new Map(), unassigned: [], reassign: [], notes: [], notAssignable: [] };

  if (mode === 'SELF') {
    for (const code of toCreate) plan.create.set(code, { userId: me, reason: 'IMPORT_OWN' });
    return plan;
  }

  const isNew = new Set(toCreate);
  const chosen = new Map<string, string>();
  for (const group of requested?.create ?? []) {
    for (const code of group.externalIds) {
      if (isNew.has(code)) chosen.set(code, group.userId);
      else plan.notes.push({ externalId: code, reason: toUpdate.has(code) ? 'NOW_EXISTING' : 'UNKNOWN_CODE' });
    }
  }
  const usableSuggestion = suggested && assignable.has(suggested.userId) ? suggested.userId : null;
  for (const code of toCreate) {
    const pick = chosen.get(code);
    if (pick) plan.create.set(code, { userId: pick, reason: 'IMPORT_CHOSEN' });
    else if (usableSuggestion) plan.create.set(code, { userId: usableSuggestion, reason: 'IMPORT_SUGGESTED' });
    else plan.unassigned.push(code);
  }

  for (const r of requested?.reassign ?? []) {
    if (!toUpdate.has(r.externalId)) {
      plan.notes.push({ externalId: r.externalId, reason: 'NOT_UPDATED' });
      continue;
    }
    if (toUpdate.get(r.externalId) === r.toUserId) continue; // «Juan → Juan» no es reasignar
    plan.reassign.push({ code: r.externalId, from: r.fromUserId, to: r.toUserId });
  }

  const targets = [...chosen.values(), ...plan.reassign.map((r) => r.to)];
  plan.notAssignable = [...new Set(targets)].filter((u) => !assignable.has(u));
  return plan;
}
