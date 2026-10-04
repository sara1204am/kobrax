import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { Permission, type Assignee } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { assigneeNotEligible, assignmentConflict, assignmentForbidden } from './assignment.errors';
import { isAssignable, notAssignable, type AssignmentChange, type AssignmentReason } from './assignment-rules';

/** Una asignación a aplicar. `expectedFrom` = el responsable que vio quien pidió el cambio. */
export interface AssignmentRequest {
  creditId: string;
  to: string | null;
  /** Ausente = no se controla (alta). Presente = si hoy es otro, conflicto (reasignar). */
  expectedFrom?: string | null;
}

/**
 * **El único lugar que escribe quién es responsable de un crédito.**
 *
 * Escribe las dos mitades juntas: la fila permanente de `credit_assignments` —la fuente de verdad
 * del alcance `own` (PLAN-SEGURIDAD §4.bis), y el historial: nunca se borra, se revoca— y su copia
 * `credits.assigned_manager_id`, que leen el trabajo de mora al abrir un caso, la ficha y el alcance
 * del import. Antes cada camino escribía sólo la columna y la tabla quedó con 0 filas vigentes.
 *
 * 🔴 **No decide permisos dentro de `apply`.** Lo llama el import en su propia transacción y en
 * bloque, y ahí hay asignaciones que deriva el sistema (`IMPORT_OWN`) sin `assignment:write`. Quien
 * elige a otra persona pasa antes por `authorize()` + `assertAssignable()`; las dos son explícitas
 * para que el `grep` de quién puede asignar sea corto.
 *
 * La auditoría va DESPUÉS del commit (`auditChanges`), como en todo el sistema: `AuditService` no
 * recibe `tx`. Lo atómico es la fila de `credit_assignments`, que ya guarda quién otorgó, a quién,
 * cuándo y quién revocó.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /** ¿Quien pide puede elegir el responsable de un crédito? */
  canAssign(): boolean {
    return this.tenant.can(Permission.ASSIGNMENT_WRITE);
  }

  /** P3 · A quién se le puede asignar: cobradores activos y quien pregunta. Yo primero, el resto por nombre. */
  async listAssignees(): Promise<Assignee[]> {
    const me = this.tenant.userId;
    const rows = await this.prisma.withTenant(this.tenant.accountId, (tx) => this.assignableRows(tx));
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
      select: { userId: true, isActive: true, role: { select: { name: true } }, user: { select: { email: true, profile: true } } },
    });
    return rows.filter((r) => isAssignable({ userId: r.userId, isActive: r.isActive, role: r.role.name }, me));
  }

  /** Frena a quien no tiene `assignment:write`. Siempre antes de aplicar una elección de persona. */
  authorize(): void {
    if (!this.canAssign()) throw assignmentForbidden();
  }

  /**
   * P3 · Todos los destinatarios tienen que ser cobradores activos de ESTA cuenta, o quien pide.
   * Una sola consulta para N ids: el import reparte cientos de créditos entre tres personas.
   */
  async assertAssignable(tx: PrismaClient, userIds: (string | null)[]): Promise<void> {
    const ids = [...new Set(userIds.filter((u): u is string => !!u))];
    if (ids.length === 0) return;
    const rows = await tx.userAccount.findMany({
      where: { accountId: this.tenant.accountId, userId: { in: ids } },
      select: { userId: true, isActive: true, role: { select: { name: true } } },
    });
    const bad = notAssignable(
      ids,
      rows.map((r) => ({ userId: r.userId, isActive: r.isActive, role: r.role.name })),
      this.tenant.userId,
    );
    if (bad.length > 0) throw assigneeNotEligible(bad);
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
        where: { creditId: { in: ids }, revokedAt: null, expiresAt: null, caseId: null },
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
        if (r.to) toCreate.push({ accountId, creditId: r.creditId, userId: r.to, startsAt: now, grantedBy: actor });
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
    return changes;
  }

  /** Un evento por crédito que cambió de responsable. Después del commit. */
  async auditChanges(changes: AssignmentChange[], extra: Record<string, unknown> = {}): Promise<void> {
    await this.audit.recordMany(
      changes.map((c) => ({
        entity: 'credit',
        entityId: c.creditId,
        action: c.from ? 'REASSIGN' : 'ASSIGN',
        before: { assignedManagerId: c.from },
        after: { assignedManagerId: c.to, reason: c.reason, ...extra },
      })),
    );
  }
}
