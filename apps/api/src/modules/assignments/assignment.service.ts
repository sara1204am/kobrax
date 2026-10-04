import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AgendaItemStatus, CreditAssignmentKind, Prisma, type PrismaClient } from '@prisma/client';
import { Permission, type Assignee } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  assigneeNotEligible,
  assignmentConflict,
  assignmentCreditNotFound,
  assignmentDuplicate,
  assignmentForbidden,
  assignmentNoPrincipal,
  assignmentNotFound,
  assignmentNotRevocable,
  assignmentOutOfAgency,
  assignmentSameAsPrincipal,
  temporaryExpiryInvalid,
} from './assignment.errors';
import { agencyViolations, isAssignable, notAssignable, type AssignScope, type AssignmentChange, type AssignmentReason } from './assignment-rules';
import { handoffFrom, isHandedOffBy, withHandoff, withoutHandoff } from './assignment-handoff';

/** Cada cuánto barre los vencimientos. Un reemplazo se pide por horas o días: 15 min alcanza y no pesa. */
export const ASSIGNMENT_EXPIRY_INTERVAL_MS = 15 * 60 * 1000;

/** Una asignación a aplicar. `expectedFrom` = el responsable que vio quien pidió el cambio. */
export interface AssignmentRequest {
  creditId: string;
  to: string | null;
  /** Ausente = no se controla (alta). Presente = si hoy es otro, conflicto (reasignar). */
  expectedFrom?: string | null;
}

/** Una cobertura (TEMPORAL o APOYO) tal como la devuelven los endpoints. */
export interface CoverageAssignment {
  id: string;
  creditId: string;
  userId: string;
  kind: 'TEMPORAL' | 'APOYO';
  startsAt: string;
  expiresAt: string | null;
  /** Sólo TEMPORAL: cuántos agendados pasaron al reemplazo. */
  agendaMoved?: number;
}

/** Resultado de reasignar varios créditos: cuántos cambiaron y cuáles se saltearon (y por qué). */
export interface BulkReassignResult {
  changed: number;
  skipped: { creditId: string; reason: BulkSkipReason }[];
}
export type BulkSkipReason = 'NOT_FOUND' | 'ALREADY_ASSIGNED' | 'OUT_OF_AGENCY' | 'CONFLICT';

export interface ExpireResult {
  /** Coberturas que vencieron y se revocaron. */
  revoked: number;
  /** Agendados que volvieron al responsable. */
  returned: number;
}

/**
 * **El único lugar que escribe quién es responsable de un crédito.**
 *
 * Escribe las dos mitades juntas: la fila permanente de `credit_assignments` —la fuente de verdad
 * del alcance `own` (PLAN-SEGURIDAD §4.bis), y el historial: nunca se borra, se revoca— y su copia
 * `credits.assigned_manager_id`, que leen el trabajo de mora al abrir un caso, la ficha y el alcance
 * del import. Antes cada camino escribía sólo la columna y la tabla quedó con 0 filas vigentes.
 *
 * F4/08 · D8-a: además del responsable (PRINCIPAL) maneja el reemplazo temporal (TEMPORAL, con vencimiento) y
 * la ayuda (APOYO). D10: al cambiar el responsable, lo agendado y sin ejecutar pasa al nuevo.
 *
 * 🔴 **No decide permisos dentro de `apply`.** Lo llama el import en su propia transacción y en
 * bloque, y ahí hay asignaciones que deriva el sistema (`IMPORT_OWN`) sin `assignment:write`. Quien
 * elige a otra persona pasa antes por `authorize()` + `assertAssignable()`; las dos son explícitas
 * para que el `grep` de quién puede asignar sea corto.
 *
 * La auditoría va DESPUÉS del commit (`auditChanges`), como en todo el sistema: `AuditService` no
 * recibe `tx`. Lo atómico es la fila de `credit_assignments`, que ya guarda quién otorgó, a quién,
 * cuándo y quién revocó. (El vencimiento, que corre sin request, escribe su auditoría en la misma transacción.)
 */
@Injectable()
export class AssignmentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AssignmentService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /**
   * El vencimiento de los reemplazos temporales y las ayudas es una tarea de sistema, con el mismo mecanismo
   * del trabajo de mora: un intervalo que no bloquea el apagado y que barre los tenants vivos.
   */
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.expireDue(), ASSIGNMENT_EXPIRY_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** ¿Quien pide puede elegir el responsable de un crédito? */
  canAssign(): boolean {
    return this.tenant.can(Permission.ASSIGNMENT_WRITE);
  }

  /**
   * A quién se le puede asignar: cobradores y supervisores activos, y quien pregunta. El supervisor sólo ve a su
   * agencia. Yo primero, el resto por nombre.
   */
  async listAssignees(): Promise<Assignee[]> {
    const me = this.tenant.userId;
    const rows = await this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      const all = await this.assignableRows(tx);
      const scope = await this.assignScope(tx);
      return scope.kind === 'ALL' ? all : all.filter((r) => scope.branchId !== null && r.branchId === scope.branchId);
    });
    return rows
      .map((r) => ({
        userId: r.userId,
        name: (r.user.profile ? `${r.user.profile.firstName} ${r.user.profile.lastName}`.trim() : '') || r.user.email,
        roleName: r.role.name,
        isMe: r.userId === me,
      }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
  }

  /** Los mismos de `listAssignees`, como conjunto de ids y dentro de una transacción en curso (el import). */
  async assignableIds(tx: PrismaClient): Promise<Set<string>> {
    return new Set((await this.assignableRows(tx)).map((r) => r.userId));
  }

  private async assignableRows(tx: PrismaClient) {
    const me = this.tenant.userId;
    const rows = await tx.userAccount.findMany({
      where: { accountId: this.tenant.accountId, isActive: true },
      select: {
        userId: true,
        isActive: true,
        branchId: true,
        role: { select: { name: true } },
        user: { select: { email: true, profile: true } },
      },
    });
    return rows.filter((r) => isAssignable({ userId: r.userId, isActive: r.isActive, role: r.role.name }, me));
  }

  /** Frena a quien no tiene `assignment:write`. Siempre antes de aplicar una elección de persona. */
  authorize(): void {
    if (!this.canAssign()) throw assignmentForbidden();
  }

  /**
   * Hasta dónde reparte quien pide (D8): `data:scope:all` (gerente, administrador) → todo; cualquier otro con
   * `assignment:write` (el supervisor) → su agencia, la de `user_accounts.branch_id`.
   */
  async assignScope(tx: PrismaClient): Promise<AssignScope> {
    if (this.tenant.can(Permission.DATA_SCOPE_ALL)) return { kind: 'ALL', branchId: null };
    const me = await tx.userAccount.findFirst({
      where: { accountId: this.tenant.accountId, userId: this.tenant.userId, isActive: true },
      select: { branchId: true },
    });
    return { kind: 'BRANCH', branchId: me?.branchId ?? null };
  }

  /**
   * P3 · Todos los destinatarios tienen que ser cobradores o supervisores activos de ESTA cuenta, o quien pide.
   * Una sola consulta para N ids: el import reparte cientos de créditos entre tres personas.
   *
   * Con `creditIds` también se aplica el límite de agencia del supervisor (D8): sus créditos y sus
   * destinatarios tienen que ser de su agencia. Gerente y administrador no tienen ese límite.
   */
  async assertAssignable(tx: PrismaClient, userIds: (string | null)[], creditIds?: string[]): Promise<void> {
    const ids = [...new Set(userIds.filter((u): u is string => !!u))];
    const rows =
      ids.length === 0
        ? []
        : await tx.userAccount.findMany({
            where: { accountId: this.tenant.accountId, userId: { in: ids } },
            select: { userId: true, isActive: true, branchId: true, role: { select: { name: true } } },
          });
    const bad = notAssignable(
      ids,
      rows.map((r) => ({ userId: r.userId, isActive: r.isActive, role: r.role.name })),
      this.tenant.userId,
    );
    if (bad.length > 0) throw assigneeNotEligible(bad);
    if (creditIds && creditIds.length > 0) {
      await this.assertAgency(
        tx,
        creditIds,
        rows.map((r) => ({ userId: r.userId, branchId: r.branchId ?? null })),
      );
    }
  }

  /**
   * El límite de agencia del supervisor sobre los DESTINATARIOS solos: para créditos que todavía no existen (los
   * nuevos de una importación) y por eso no se pueden pasar a `assertAssignable` por id. Gerente y administrador no
   * tienen límite; el supervisor sólo reparte a gente de su agencia (él incluido).
   */
  async assertAssigneesInAgency(tx: PrismaClient, userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const scope = await this.assignScope(tx);
    if (scope.kind === 'ALL') return;
    const rows = await tx.userAccount.findMany({ where: { accountId: this.tenant.accountId, userId: { in: ids } }, select: { userId: true, branchId: true } });
    const known = new Map(rows.map((r) => [r.userId, r.branchId ?? null]));
    const v = agencyViolations(scope, [], ids.map((userId) => ({ userId, branchId: known.get(userId) ?? null })));
    if (v.userIds.length > 0) throw assignmentOutOfAgency([], v.userIds);
  }

  /** El límite de agencia del supervisor sobre estos créditos y estos destinatarios (ya cargados). */
  private async assertAgency(tx: PrismaClient, creditIds: string[], assignees: { userId: string; branchId: string | null }[]): Promise<void> {
    const scope = await this.assignScope(tx);
    if (scope.kind === 'ALL') return;
    const credits = await tx.credit.findMany({ where: { id: { in: creditIds }, deletedAt: null }, select: { id: true, branchId: true } });
    const v = agencyViolations(
      scope,
      credits.map((c) => ({ id: c.id, branchId: c.branchId ?? null })),
      assignees,
    );
    if (v.creditIds.length > 0 || v.userIds.length > 0) throw assignmentOutOfAgency(v.creditIds, v.userIds);
  }

  /**
   * Aplica los responsables pedidos. Idempotente: pedir el que ya está no escribe nada (y repara la
   * columna si se había separado de la tabla).
   *
   * Devuelve sólo los cambios reales, para auditarlos después del commit.
   */
  async apply(tx: PrismaClient, requests: AssignmentRequest[], reason: AssignmentReason): Promise<AssignmentChange[]> {
    if (requests.length === 0) return [];
    const accountId = this.tenant.accountId;
    const actor = this.tenant.userId ?? null;
    const ids = [...new Set(requests.map((r) => r.creditId))];

    const [credits, permanents] = await Promise.all([
      tx.credit.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, assignedManagerId: true } }),
      tx.creditAssignment.findMany({
        // Sólo el responsable: una ayuda (APOYO) también es permanente y no es «el» responsable.
        where: { creditId: { in: ids }, kind: CreditAssignmentKind.PRINCIPAL, revokedAt: null, expiresAt: null, caseId: null },
        select: { id: true, creditId: true, userId: true },
      }),
    ]);
    const column = new Map(credits.map((c) => [c.id, c.assignedManagerId]));
    const active = new Map(permanents.map((p) => [p.creditId, p]));

    const conflicts = requests.filter((r) => r.expectedFrom !== undefined && column.get(r.creditId) !== r.expectedFrom);
    if (conflicts.length > 0) throw assignmentConflict(conflicts.map((r) => r.creditId));

    const changes: AssignmentChange[] = [];
    const toRevoke: string[] = [];
    const toCreate: Prisma.CreditAssignmentCreateManyInput[] = [];
    const columnFix = new Map<string | null, string[]>();
    const now = new Date();

    for (const r of requests) {
      if (!column.has(r.creditId)) continue; // borrado o de otra cuenta: no hay nada que asignar
      const current = active.get(r.creditId);
      const from = current?.userId ?? null;
      if (from !== r.to) {
        if (current) toRevoke.push(current.id);
        if (r.to) toCreate.push({ accountId, creditId: r.creditId, userId: r.to, kind: CreditAssignmentKind.PRINCIPAL, startsAt: now, grantedBy: actor });
        changes.push({ creditId: r.creditId, from, to: r.to, reason });
      }
      if (column.get(r.creditId) !== r.to) columnFix.set(r.to, [...(columnFix.get(r.to) ?? []), r.creditId]);
    }

    try {
      if (toRevoke.length > 0) {
        await tx.creditAssignment.updateMany({ where: { id: { in: toRevoke } }, data: { revokedAt: now, revokedBy: actor } });
      }
      if (toCreate.length > 0) await tx.creditAssignment.createMany({ data: toCreate });
    } catch (e) {
      // Dos escrituras a la vez sobre el mismo crédito: el índice de «una permanente» frena la segunda.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw assignmentConflict(ids);
      throw e;
    }
    for (const [to, creditIds] of columnFix) {
      await tx.credit.updateMany({ where: { id: { in: creditIds } }, data: { assignedManagerId: to } });
    }
    // D10: lo agendado y sin ejecutar pasa al nuevo responsable, en la misma transacción que el cambio.
    await this.handOffAgenda(tx, changes, actor);
    return changes;
  }

  /**
   * D10 · Al cambiar el responsable, los agendados **pendientes** (SCHEDULED, no borrados) del crédito que tenía
   * el anterior pasan al nuevo. Lo ya ejecutado, cancelado o reagendado queda a nombre de quien lo hizo.
   * Sólo cuando hay anterior y nuevo: asignar por primera vez o quitar al responsable no mueve nada.
   * Lo que un reemplazo temporal tiene a su nombre no se toca: vuelve al vencer, a quien sea entonces el responsable.
   */
  private async handOffAgenda(tx: PrismaClient, changes: AssignmentChange[], actor: string | null): Promise<void> {
    const byPair = new Map<string, { from: string; to: string; creditIds: string[] }>();
    for (const c of changes) {
      if (!c.from || !c.to) continue;
      const key = `${c.from}>${c.to}`;
      const g = byPair.get(key) ?? { from: c.from, to: c.to, creditIds: [] };
      g.creditIds.push(c.creditId);
      byPair.set(key, g);
    }
    for (const g of byPair.values()) {
      const items = await tx.agendaItem.findMany({
        where: { creditId: { in: g.creditIds }, assigneeId: g.from, status: AgendaItemStatus.SCHEDULED, deletedAt: null },
        select: { id: true, creditId: true },
      });
      if (items.length === 0) continue;
      await tx.agendaItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { assigneeId: g.to, updatedBy: actor } });
      const perCredit = new Map<string, number>();
      for (const i of items) perCredit.set(i.creditId, (perCredit.get(i.creditId) ?? 0) + 1);
      for (const c of changes) if (c.from === g.from && c.to === g.to) c.agendaMoved = perCredit.get(c.creditId) ?? 0;
    }
  }

  /**
   * Reasigna el RESPONSABLE de varios créditos a `userId` (acción masiva de la lista de mora, F4/08).
   *
   * 🔴 **Atómico por crédito, no en bloque**: cada crédito va en su propia transacción con `apply()` (traspaso de
   * agenda D10 incluido). Un crédito que no se puede (borrado, ya es suyo, fuera de la agencia del supervisor,
   * o cambió mientras tanto) se saltea y se informa; no frena a los demás ni deshace los ya hechos.
   *
   * El destinatario se valida UNA vez al principio (cobrador o supervisor activo): si no lo es, es un 422 de toda la
   * petición y no se toca nada. El límite de agencia del supervisor se aplica por crédito con
   * `assertAssignable(tx, [userId], [creditId])`. La auditoría va después de cada commit (`auditChanges`).
   */
  async bulkReassign(input: { creditIds: string[]; userId: string }): Promise<BulkReassignResult> {
    this.authorize();
    const accountId = this.tenant.accountId;
    const ids = [...new Set(input.creditIds)];
    await this.prisma.withTenant(accountId, (tx) => this.assertAssignable(tx, [input.userId]));

    const changes: AssignmentChange[] = [];
    const skipped: BulkReassignResult['skipped'] = [];
    for (const creditId of ids) {
      try {
        const out = await this.prisma.withTenant(accountId, async (tx) => {
          const credit = await tx.credit.findFirst({ where: { id: creditId, deletedAt: null }, select: { id: true, assignedManagerId: true } });
          if (!credit) return { skip: 'NOT_FOUND' as const };
          if (credit.assignedManagerId === input.userId) return { skip: 'ALREADY_ASSIGNED' as const };
          await this.assertAssignable(tx, [input.userId], [creditId]); // la agencia del supervisor
          const done = await this.apply(tx, [{ creditId, to: input.userId, expectedFrom: credit.assignedManagerId }], 'BULK_REASSIGN');
          return { done };
        });
        if ('skip' in out && out.skip) skipped.push({ creditId, reason: out.skip });
        else if ('done' in out && out.done) changes.push(...out.done);
      } catch (e) {
        const code = (e as { response?: { code?: string } } | null)?.response?.code;
        if (code === 'ASSIGNMENT_OUT_OF_AGENCY') skipped.push({ creditId, reason: 'OUT_OF_AGENCY' });
        else if (code === 'ASSIGNMENT_CONFLICT') skipped.push({ creditId, reason: 'CONFLICT' });
        else throw e;
      }
    }
    await this.auditChanges(changes, { bulk: true });
    return { changed: changes.length, skipped };
  }

  // ── Reemplazo temporal y ayuda (D8-a) ──────────────────────────────────────────────────────────

  /**
   * Un reemplazo temporal: `userId` cubre el crédito hasta `expiresAt`. Mientras dura, lo agendado pendiente
   * del responsable pasa al reemplazo (cada ítem queda marcado en `details` para poder devolverlo) y el
   * responsable **conserva** el crédito y su visibilidad. Un solo reemplazo vigente por crédito.
   */
  async createTemporary(input: { creditId: string; userId: string; expiresAt: Date; reason?: string }): Promise<CoverageAssignment> {
    this.authorize();
    const now = new Date();
    if (!(input.expiresAt.getTime() > now.getTime())) throw temporaryExpiryInvalid();
    const actor = this.tenant.userId ?? null;

    const out = await this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      const credit = await tx.credit.findFirst({ where: { id: input.creditId, deletedAt: null }, select: { id: true, assignedManagerId: true } });
      if (!credit) throw assignmentCreditNotFound();
      await this.assertAssignable(tx, [input.userId], [credit.id]);
      const principal = credit.assignedManagerId;
      if (!principal) throw assignmentNoPrincipal();
      if (principal === input.userId) throw assignmentSameAsPrincipal();
      const current = await tx.creditAssignment.findFirst({
        where: { creditId: credit.id, kind: CreditAssignmentKind.TEMPORAL, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (current) throw assignmentDuplicate('TEMPORAL');

      const row = await tx.creditAssignment.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: credit.id,
          userId: input.userId,
          kind: CreditAssignmentKind.TEMPORAL,
          startsAt: now,
          expiresAt: input.expiresAt,
          grantedBy: actor,
        },
      });
      const pending = await tx.agendaItem.findMany({
        where: { creditId: credit.id, assigneeId: principal, status: AgendaItemStatus.SCHEDULED, deletedAt: null },
        select: { id: true, details: true },
      });
      for (const item of pending) {
        await tx.agendaItem.update({
          where: { id: item.id },
          data: { assigneeId: input.userId, updatedBy: actor, details: withHandoff(item.details, principal, row.id) as Prisma.InputJsonObject },
        });
      }
      return { row, moved: pending.length, principal };
    });

    await this.audit.record({
      entity: 'credit',
      entityId: input.creditId,
      action: 'ASSIGN_TEMPORARY',
      after: {
        assignmentId: out.row.id,
        principalId: out.principal,
        temporaryUserId: input.userId,
        expiresAt: input.expiresAt.toISOString(),
        reason: input.reason ?? null,
        agendaMoved: out.moved,
      },
    });
    return coverageOf(out.row, out.moved);
  }

  /** La ayuda: un segundo cobrador que ve y trabaja el crédito. Sin vencimiento obligatorio, sin traspaso de agenda. */
  async createSupport(input: { creditId: string; userId: string; expiresAt?: Date | null }): Promise<CoverageAssignment> {
    this.authorize();
    const now = new Date();
    if (input.expiresAt && !(input.expiresAt.getTime() > now.getTime())) throw temporaryExpiryInvalid();
    const actor = this.tenant.userId ?? null;

    const row = await this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      const credit = await tx.credit.findFirst({ where: { id: input.creditId, deletedAt: null }, select: { id: true, assignedManagerId: true } });
      if (!credit) throw assignmentCreditNotFound();
      await this.assertAssignable(tx, [input.userId], [credit.id]);
      if (credit.assignedManagerId === input.userId) throw assignmentSameAsPrincipal();
      const dup = await tx.creditAssignment.findFirst({
        where: {
          creditId: credit.id,
          userId: input.userId,
          kind: CreditAssignmentKind.APOYO,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });
      if (dup) throw assignmentDuplicate('APOYO');
      return tx.creditAssignment.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: credit.id,
          userId: input.userId,
          kind: CreditAssignmentKind.APOYO,
          startsAt: now,
          expiresAt: input.expiresAt ?? null,
          grantedBy: actor,
        },
      });
    });

    await this.audit.record({
      entity: 'credit',
      entityId: input.creditId,
      action: 'ASSIGN_SUPPORT',
      after: { assignmentId: row.id, supportUserId: input.userId, expiresAt: input.expiresAt?.toISOString() ?? null },
    });
    return coverageOf(row);
  }

  /**
   * Revoca un reemplazo temporal o una ayuda. En el temporal, lo agendado que sigue pendiente y que él recibió
   * vuelve al responsable; lo que el reemplazo creó o ejecutó se queda.
   */
  async revoke(assignmentId: string): Promise<{ id: string; revoked: true; agendaReturned: number }> {
    this.authorize();
    const actor = this.tenant.userId ?? null;
    const now = new Date();

    const out = await this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      const row = await tx.creditAssignment.findFirst({ where: { id: assignmentId, revokedAt: null } });
      if (!row) throw assignmentNotFound();
      if (row.kind === CreditAssignmentKind.PRINCIPAL) throw assignmentNotRevocable();
      await this.assertAgency(tx, [row.creditId], []);
      await tx.creditAssignment.update({ where: { id: row.id }, data: { revokedAt: now, revokedBy: actor } });
      const returned = row.kind === CreditAssignmentKind.TEMPORAL ? await this.returnAgenda(tx, row, actor) : 0;
      return { row, returned };
    });

    await this.audit.record({
      entity: 'credit',
      entityId: out.row.creditId,
      action: out.row.kind === CreditAssignmentKind.TEMPORAL ? 'REVOKE_TEMPORARY' : 'REVOKE_SUPPORT',
      before: { assignmentId: out.row.id, userId: out.row.userId, expiresAt: out.row.expiresAt?.toISOString() ?? null },
      after: { revoked: true, agendaReturned: out.returned },
    });
    return { id: out.row.id, revoked: true, agendaReturned: out.returned };
  }

  /**
   * Devuelve al responsable lo agendado que esta cobertura recibió y sigue pendiente (SCHEDULED, sin borrar,
   * con su marca y todavía a nombre del reemplazo). Vuelve a quien sea el responsable **hoy**, no a quien lo era
   * al traspasar. Quita la marca. Lo ejecutado o creado por el reemplazo no se toca.
   */
  private async returnAgenda(tx: PrismaClient, row: { id: string; creditId: string; userId: string }, actor: string | null): Promise<number> {
    const credit = await tx.credit.findFirst({ where: { id: row.creditId }, select: { assignedManagerId: true } });
    const items = await tx.agendaItem.findMany({
      where: { creditId: row.creditId, status: AgendaItemStatus.SCHEDULED, deletedAt: null },
      select: { id: true, assigneeId: true, details: true },
    });
    let returned = 0;
    for (const item of items) {
      if (!isHandedOffBy(item.details, row.id)) continue;
      // Si alguien lo reasignó a mano mientras tanto, sólo se limpia la marca.
      const target = item.assigneeId === row.userId ? (credit?.assignedManagerId ?? handoffFrom(item.details)) : null;
      await tx.agendaItem.update({
        where: { id: item.id },
        data: { ...(target ? { assigneeId: target } : {}), updatedBy: actor, details: withoutHandoff(item.details) as Prisma.InputJsonObject },
      });
      if (target) returned++;
    }
    return returned;
  }

  /**
   * Revoca las coberturas (TEMPORAL y APOYO) vencidas y devuelve lo agendado de las temporales. **Idempotente**:
   * una segunda corrida no encuentra nada. Tarea de sistema: barre los tenants vivos y cada uno bajo su RLS.
   */
  async expireDue(now: Date = new Date()): Promise<ExpireResult> {
    const total: ExpireResult = { revoked: 0, returned: 0 };
    let accountIds: string[];
    try {
      const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM promise_due_account_ids()`;
      accountIds = rows.map((r) => r.account_id);
    } catch (err) {
      this.logger.warn(`promise_due_account_ids() no disponible — vencimientos de asignaciones omitidos: ${err instanceof Error ? err.message : String(err)}`);
      return total;
    }
    for (const accountId of accountIds) {
      try {
        const r = await this.expireAccount(accountId, now);
        total.revoked += r.revoked;
        total.returned += r.returned;
      } catch (err) {
        this.logger.error(`Vencimiento de asignaciones falló en tenant ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (total.revoked > 0) this.logger.log(`Asignaciones vencidas: ${total.revoked}, agendados devueltos: ${total.returned}`);
    return total;
  }

  /** Un tenant. Sin contexto de request: la auditoría se escribe en la misma transacción. */
  async expireAccount(accountId: string, now: Date = new Date()): Promise<ExpireResult> {
    return this.prisma.withTenant(accountId, async (tx) => {
      const due = await tx.creditAssignment.findMany({
        where: {
          accountId,
          revokedAt: null,
          kind: { in: [CreditAssignmentKind.TEMPORAL, CreditAssignmentKind.APOYO] },
          expiresAt: { lte: now },
        },
        orderBy: { expiresAt: 'asc' },
        take: 500,
      });
      const out: ExpireResult = { revoked: 0, returned: 0 };
      const audits: Prisma.AuditLogCreateManyInput[] = [];
      for (const row of due) {
        // revokedAt = el vencimiento, no la hora del barrido: es cuándo dejó de valer.
        const done = await tx.creditAssignment.updateMany({
          where: { id: row.id, revokedAt: null },
          data: { revokedAt: row.expiresAt ?? now, revokedBy: null },
        });
        if (done.count === 0) continue; // otra instancia (o un revoke manual) ya la cerró
        out.revoked++;
        const returned = row.kind === CreditAssignmentKind.TEMPORAL ? await this.returnAgenda(tx, row, null) : 0;
        out.returned += returned;
        // `audit_logs.user_id` es obligatorio: quien la otorgó o, si la creó el sistema, la propia persona cubierta.
        audits.push({
          accountId,
          userId: row.grantedBy ?? row.userId,
          action: row.kind === CreditAssignmentKind.TEMPORAL ? 'EXPIRE_TEMPORARY' : 'EXPIRE_SUPPORT',
          entity: 'credit',
          entityId: row.creditId,
          before: { assignmentId: row.id, userId: row.userId, expiresAt: row.expiresAt?.toISOString() ?? null },
          after: { revoked: true, agendaReturned: returned, system: true },
        });
      }
      if (audits.length > 0) await tx.auditLog.createMany({ data: audits });
      return out;
    });
  }

  /** Un evento por crédito que cambió de responsable. Después del commit. */
  async auditChanges(changes: AssignmentChange[], extra: Record<string, unknown> = {}): Promise<void> {
    await this.audit.recordMany(
      changes.map((c) => ({
        entity: 'credit',
        entityId: c.creditId,
        action: c.from ? 'REASSIGN' : 'ASSIGN',
        before: { assignedManagerId: c.from },
        after: { assignedManagerId: c.to, reason: c.reason, ...(c.agendaMoved ? { agendaMoved: c.agendaMoved } : {}), ...extra },
      })),
    );
  }
}

function coverageOf(
  row: { id: string; creditId: string; userId: string; kind: string; startsAt: Date; expiresAt: Date | null },
  agendaMoved?: number,
): CoverageAssignment {
  return {
    id: row.id,
    creditId: row.creditId,
    userId: row.userId,
    kind: row.kind as 'TEMPORAL' | 'APOYO',
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    ...(agendaMoved !== undefined ? { agendaMoved } : {}),
  };
}
