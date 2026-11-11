import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../context/tenant-context.service';
import type { AssignScope } from '../office-scope/office-scope';
import { OfficeScopeService } from '../office-scope/office-scope.service';
import type { RoleFact } from './tier';

/** Una persona de la cuenta tal como la necesitan las políticas: rol, estado y rutas de sus oficinas vigentes. */
export interface MemberFact {
  userId: string;
  active: boolean;
  role: RoleFact;
  paths: string[];
}

/** Una oficina de la cuenta y si cae en el alcance de quien pregunta. */
export interface BranchFact {
  id: string;
  path: string;
  isRoot: boolean;
  active: boolean;
  inScope: boolean;
}

/** Lo que la política `role.editPermissions` necesita saber del rol que se edita y del catálogo (F14 · F7). */
export interface RoleEditFacts {
  role: { id: string; key: string; version: number; permissions: string[] } | null;
  catalog: { code: string; reserved: 'PLATFORM' | 'ADMIN_CORE' | null; requires: string[] }[];
  /** ¿Quien edita pertenece (con membresía activa) al rol que edita? */
  actorInTargetRole: boolean;
}

/**
 * Carga los HECHOS que las políticas necesitan (oficinas de una persona, oficina de un crédito, rol y nivel…) en consultas acotadas al
 * tenant. Es la única puerta de las políticas a la DB: la política en sí queda pura y se prueba sin base de datos.
 * Cada método acepta la `tx` del servicio que pregunta para leer con la misma foto; sin ella abre su propia transacción.
 */
@Injectable()
export class FactsLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly office: OfficeScopeService,
  ) {}

  /** El usuario de la sesión (las políticas con hechos del actor lo necesitan). */
  actorId(): string {
    const id = this.tenant.userId;
    if (!id) throw new Error('FactsLoader requiere un request autenticado');
    return id;
  }

  private run<T>(tx: PrismaClient | undefined, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Rutas de las oficinas vigentes de una persona (vacío = sin oficina). */
  officePathsOf(userId: string, tx?: PrismaClient): Promise<string[]> {
    return this.run(tx, (t) => this.office.pathsOf(t, userId));
  }

  /** Ruta de la oficina de un crédito (`null` = sin oficina o no existe en esta cuenta). */
  async creditOfficePath(creditId: string, tx?: PrismaClient): Promise<string | null> {
    const map = await this.run(tx, (t) => this.office.creditOfficePaths(t, [creditId]));
    return map.get(creditId) ?? null;
  }

  /** Hasta dónde reparte/ve quien pregunta, por capacidad (ALL o las rutas de sus asignaciones). */
  assignScope(tx?: PrismaClient): Promise<AssignScope> {
    return this.run(tx, (t) => this.office.assignScope(t));
  }

  /** La única oficina hoja viva de la cuenta, o `null` si hay varias (cuenta individual o de una sola oficina). */
  soleLeafOffice(tx?: PrismaClient): Promise<string | null> {
    return this.run(tx, (t) => this.office.soleLeafOffice(t));
  }

  /** La oficina de la ÚNICA asignación vigente de una persona, o `null`. */
  soleOfficeOf(userId: string, tx?: PrismaClient): Promise<string | null> {
    return this.run(tx, (t) => this.office.soleOfficeOf(t, userId));
  }

  /** Una oficina de ESTA cuenta con su ruta, si es la raíz, si está activa y si cae en `scope`. `null` = no existe. */
  async branch(branchId: string, scope: AssignScope, tx?: PrismaClient): Promise<BranchFact | null> {
    return this.run(tx, async (t) => {
      const b = await t.branch.findFirst({
        where: { id: branchId, accountId: this.tenant.accountId, deletedAt: null },
        select: { id: true, path: true, isRoot: true, active: true },
      });
      return b ? { ...b, inScope: this.office.inScope(scope, b.path) } : null;
    });
  }

  /** Varias personas de la cuenta con su rol y las rutas de sus oficinas. Las que no existen en la cuenta no vienen. */
  async members(userIds: string[], tx?: PrismaClient): Promise<MemberFact[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    return this.run(tx, async (t) => {
      const rows = await t.userAccount.findMany({
        where: { accountId: this.tenant.accountId, userId: { in: ids } },
        select: { userId: true, isActive: true, role: { select: { name: true, level: true } } },
      });
      const paths = await this.office.assignmentPaths(t, ids);
      return rows.map((r) => ({ userId: r.userId, active: r.isActive, role: { name: r.role.name, level: r.role.level }, paths: paths.get(r.userId) ?? [] }));
    });
  }

  /** El rol de la cuenta que se edita (por clave), el catálogo de permisos y si quien edita pertenece a ese rol. */
  async roleEditFacts(key: string, tx?: PrismaClient): Promise<RoleEditFacts> {
    return this.run(tx, async (t) => {
      const accountId = this.tenant.accountId;
      const [role, catalog, mine] = await Promise.all([
        t.accountRole.findFirst({
          where: { accountId, key, deletedAt: null },
          select: { id: true, key: true, version: true, permissions: { select: { permission: { select: { code: true } } } } },
        }),
        t.permission.findMany({ where: { active: true }, select: { code: true, reserved: true, requires: true } }),
        this.tenant.userId
          ? t.userAccount.findFirst({ where: { userId: this.tenant.userId, accountId, isActive: true }, select: { accountRole: { select: { key: true } } } })
          : Promise.resolve(null),
      ]);
      return {
        role: role ? { id: role.id, key: role.key, version: role.version, permissions: role.permissions.map((p) => p.permission.code).sort() } : null,
        catalog: catalog.map((c) => ({ code: c.code, reserved: c.reserved, requires: Array.isArray(c.requires) ? (c.requires as string[]) : [] })),
        actorInTargetRole: mine?.accountRole?.key === key,
      };
    });
  }

  /** Un rol por id (los roles son globales hasta F5). */
  async role(roleId: string, tx?: PrismaClient): Promise<RoleFact | null> {
    return this.run(tx, async (t) => {
      const r = await t.role.findUnique({ where: { id: roleId }, select: { name: true, level: true } });
      return r ? { name: r.name, level: r.level } : null;
    });
  }
}
