import { Injectable } from '@nestjs/common';
import type { Branch, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { serializeBranch, type BranchStats } from './branches.serializer';
import { AssignMembersDto, CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import {
  branchCodeDuplicate,
  branchHasMembers,
  branchInactive,
  branchManagerInvalid,
  branchMembersInvalid,
  branchNotFound,
} from './branches.errors';

const normalizeCode = (code: string | null | undefined): string | null | undefined =>
  code === undefined || code === null ? code : code.toUpperCase();

/**
 * Agencias (sucursales) de la cuenta (Refactor de Cuenta · F6).
 *
 * El modelo y sus referencias ya existían —`user_accounts.branch_id`, `credits.branch_id`, rutas— y el alcance del
 * supervisor ("ve su agencia") ya se apoya en ellas; lo que faltaba era poder crearlas y asignarlas. Cambiar la agencia
 * de una persona **cambia lo que ve**, por eso toda mutación se audita y desactivar exige vaciarla antes.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Miembros activos, créditos y nombre del responsable de cada agencia, en tres consultas (no una por agencia). */
  private async statsFor(tx: PrismaClient, branches: Branch[]): Promise<Map<string, BranchStats>> {
    const ids = branches.map((b) => b.id);
    const managerIds = branches.map((b) => b.managerUserId).filter((x): x is string => !!x);
    const [members, credits, managers] = await Promise.all([
      ids.length ? tx.userAccount.groupBy({ by: ['branchId'], where: { branchId: { in: ids }, isActive: true }, _count: { _all: true } }) : [],
      ids.length ? tx.credit.groupBy({ by: ['branchId'], where: { branchId: { in: ids } }, _count: { _all: true } }) : [],
      managerIds.length ? tx.profile.findMany({ where: { userId: { in: managerIds } }, select: { userId: true, firstName: true, lastName: true } }) : [],
    ]);
    const memberCount = new Map(members.map((m) => [m.branchId, m._count._all]));
    const creditCount = new Map(credits.map((c) => [c.branchId, c._count._all]));
    const nameOf = new Map(managers.map((p) => [p.userId, `${p.firstName} ${p.lastName}`.trim()]));
    return new Map(
      branches.map((b) => [
        b.id,
        {
          members: memberCount.get(b.id) ?? 0,
          credits: creditCount.get(b.id) ?? 0,
          managerName: b.managerUserId ? (nameOf.get(b.managerUserId) ?? null) : null,
        },
      ]),
    );
  }

  async list() {
    return this.tx(async (tx) => {
      const rows = await tx.branch.findMany({ where: { deletedAt: null }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
      const stats = await this.statsFor(tx, rows);
      return rows.map((b) => serializeBranch(b, stats.get(b.id)!));
    });
  }

  /** El responsable es una persona activa de **esta** cuenta (la RLS ya acota `user_accounts` al tenant). */
  private async assertManager(tx: PrismaClient, userId: string): Promise<void> {
    const member = await tx.userAccount.findFirst({ where: { userId, isActive: true }, select: { id: true } });
    if (!member) throw branchManagerInvalid();
  }

  /** El código es único entre las agencias vivas. La base lo garantiza; esto da el 409 en vez de un 500. */
  private async assertCodeFree(tx: PrismaClient, code: string, exceptId?: string): Promise<void> {
    const clash = await tx.branch.findFirst({
      where: { code, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw branchCodeDuplicate(code);
  }

  /** Cuántos miembros activos tiene: lo que impide dar de baja la agencia. */
  private async assertEmpty(tx: PrismaClient, branchId: string): Promise<void> {
    const members = await tx.userAccount.count({ where: { branchId, isActive: true } });
    if (members > 0) throw branchHasMembers(members);
  }

  private async one(id: string) {
    return this.tx(async (tx) => {
      const row = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw branchNotFound();
      const stats = await this.statsFor(tx, [row]);
      return serializeBranch(row, stats.get(row.id)!);
    });
  }

  async create(dto: CreateBranchDto) {
    const code = normalizeCode(dto.code) ?? null;
    const created = await this.tx(async (tx) => {
      if (code) await this.assertCodeFree(tx, code);
      if (dto.managerUserId) await this.assertManager(tx, dto.managerUserId);
      return tx.branch.create({
        data: {
          accountId: this.tenant.accountId,
          name: dto.name.trim(),
          code,
          city: dto.city ?? null,
          address: dto.address ?? null,
          managerUserId: dto.managerUserId ?? null,
        },
      });
    });
    await this.audit.record({ entity: 'branch', entityId: created.id, action: 'CREATE', after: created });
    return this.one(created.id);
  }

  async update(id: string, dto: UpdateBranchDto) {
    const { before, updated } = await this.tx(async (tx) => {
      const before = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw branchNotFound();

      const code = normalizeCode(dto.code);
      if (code) await this.assertCodeFree(tx, code, id);
      if (dto.managerUserId) await this.assertManager(tx, dto.managerUserId);
      if (dto.active === false && before.active) await this.assertEmpty(tx, id);

      const updated = await tx.branch.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          code,
          city: dto.city,
          address: dto.address,
          managerUserId: dto.managerUserId,
          active: dto.active,
        },
      });
      return { before, updated };
    });
    await this.audit.record({ entity: 'branch', entityId: id, action: 'UPDATE', before, after: updated });
    return this.one(id);
  }

  /** Baja lógica. Libera el código y esconde la agencia; los créditos y rutas que la nombran conservan su referencia. */
  async remove(id: string): Promise<void> {
    const removed = await this.tx(async (tx) => {
      const found = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!found) throw branchNotFound();
      await this.assertEmpty(tx, id);
      return tx.branch.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    });
    await this.audit.record({ entity: 'branch', entityId: id, action: 'DELETE', before: removed });
  }

  /**
   * Pasa varias personas a esta agencia en una sola transacción. Cambia lo que ven (el alcance del supervisor sale de
   * su agencia), así que cada movimiento queda en la auditoría con la agencia anterior.
   */
  async assignMembers(id: string, dto: AssignMembersDto) {
    const moved = await this.tx(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!branch) throw branchNotFound();
      if (!branch.active) throw branchInactive();

      const members = await tx.userAccount.findMany({
        where: { userId: { in: dto.userIds }, isActive: true },
        select: { id: true, userId: true, branchId: true },
      });
      if (members.length !== dto.userIds.length) throw branchMembersInvalid();

      await tx.userAccount.updateMany({ where: { id: { in: members.map((m) => m.id) } }, data: { branchId: id } });
      return members.filter((m) => m.branchId !== id);
    });
    for (const m of moved) {
      await this.audit.record({
        entity: 'user_account',
        entityId: m.id,
        action: 'UPDATE',
        before: { branchId: m.branchId },
        after: { branchId: id },
      });
    }
    return this.one(id);
  }
}
