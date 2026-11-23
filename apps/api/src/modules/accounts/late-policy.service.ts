import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { validateLatePolicy, type LatePolicyDayCount, type LatePolicyInfo, type LatePolicyKind } from '@kobrax/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { UpdateLatePolicyDto } from './dto/late-policy.dto';
import { latePolicyConflict, latePolicyInvalid } from './accounts.errors';

type PolicyRow = {
  id: string;
  version: number;
  kind: LatePolicyKind;
  annualRate: { toString(): string } | null;
  dayCount: number | null;
  graceDays: number;
  capPctOfPrincipal: { toString(): string } | null;
  effectiveFrom: Date;
  createdBy: string | null;
};

const num = (d: { toString(): string } | null): number | null => (d === null ? null : Number(d.toString()));

/** Lo que la auditoría guarda de una versión: los parámetros, sin ids internos. */
const auditShape = (r: PolicyRow | null) =>
  r
    ? { version: r.version, kind: r.kind, annualRate: num(r.annualRate), dayCount: r.dayCount, graceDays: r.graceDays, capPctOfPrincipal: num(r.capPctOfPrincipal) }
    : null;

/**
 * La política de interés moratorio de la cuenta (F17 · F3).
 *
 * 🔴 **Apagada por defecto.** Una cuenta sin versiones —o con la v1— está en `NONE`: sin cargos. Sólo un cambio explícito desde
 * Configuración → Cuenta → Cobranza crea una versión `ANNUAL_RATE`, y cada cambio es una FILA NUEVA (la tabla es append-only: la base niega
 * UPDATE y DELETE). Los créditos ya creados conservan la versión con que nacieron (`credits.late_policy_version_id`, sellada por trigger),
 * así que activar o cambiar la política nunca es retroactivo (D8): sólo los créditos que se creen después la toman.
 */
@Injectable()
export class LatePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private latest(tx: PrismaClient): Promise<PolicyRow | null> {
    return tx.latePolicyVersion.findFirst({
      where: { accountId: this.tenant.accountId, scope: 'ACCOUNT' },
      orderBy: { version: 'desc' },
    }) as Promise<PolicyRow | null>;
  }

  /** La vigente. Una cuenta que todavía no tiene ninguna se lee como «sin cargos», sin escribir nada. */
  async current(): Promise<LatePolicyInfo> {
    return this.tx(async (tx) => this.info(tx, await this.latest(tx)));
  }

  /**
   * Cambia la política creando una versión. Si lo pedido es IGUAL a lo vigente no crea nada (reintentar un guardado no ensucia el
   * historial). Todo en una transacción con su rastro de auditoría; el candado por cuenta serializa a dos administradores a la vez.
   */
  async change(dto: UpdateLatePolicyDto): Promise<LatePolicyInfo> {
    const reason = validateLatePolicy(dto);
    if (reason) throw latePolicyInvalid(reason);
    const accountId = this.tenant.accountId;

    return this.tx(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`late_policy:${accountId}`}))`;
      const before = await this.latest(tx);

      const wanted = {
        kind: dto.kind,
        annualRate: dto.kind === 'ANNUAL_RATE' ? dto.annualRate! : null,
        dayCount: dto.kind === 'ANNUAL_RATE' ? dto.dayCount! : null,
        graceDays: dto.kind === 'ANNUAL_RATE' ? (dto.graceDays ?? 0) : 0,
        capPctOfPrincipal: dto.kind === 'ANNUAL_RATE' ? (dto.capPctOfPrincipal ?? null) : null,
      };
      const same =
        before !== null &&
        before.kind === wanted.kind &&
        num(before.annualRate) === wanted.annualRate &&
        before.dayCount === wanted.dayCount &&
        before.graceDays === wanted.graceDays &&
        num(before.capPctOfPrincipal) === wanted.capPctOfPrincipal;
      // Sin versión previa y pidiendo «sin cargos»: ya es lo que se lee, no hace falta una fila.
      if (same || (before === null && wanted.kind === 'NONE')) return this.info(tx, before);

      let created: PolicyRow;
      try {
        created = (await tx.latePolicyVersion.create({
          data: { accountId, scope: 'ACCOUNT', version: (before?.version ?? 0) + 1, createdBy: this.tenant.userId ?? null, ...wanted },
        })) as PolicyRow;
      } catch (err) {
        // El único (cuenta, alcance, tipo, versión) es la última red si el candado no alcanzó.
        if ((err as { code?: string }).code === 'P2002') throw latePolicyConflict();
        throw err;
      }

      await this.audit.recordInTx(tx, {
        entity: 'late_policy',
        entityId: created.id,
        action: 'CREATE',
        before: auditShape(before),
        after: auditShape(created),
      });
      return this.info(tx, created);
    });
  }

  private async info(tx: PrismaClient, row: PolicyRow | null): Promise<LatePolicyInfo> {
    if (!row) return { kind: 'NONE', annualRate: null, dayCount: null, graceDays: 0, capPctOfPrincipal: null, version: 0, effectiveFrom: new Date(0).toISOString(), createdByName: null };
    let createdByName: string | null = null;
    if (row.createdBy) {
      const u = await tx.user.findFirst({ where: { id: row.createdBy }, select: { email: true, profile: { select: { firstName: true, lastName: true } } } });
      createdByName = u ? [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ') || u.email : null;
    }
    return {
      kind: row.kind,
      annualRate: num(row.annualRate),
      dayCount: row.dayCount as LatePolicyDayCount | null,
      graceDays: row.graceDays,
      capPctOfPrincipal: num(row.capPctOfPrincipal),
      version: row.version,
      effectiveFrom: row.effectiveFrom.toISOString(),
      createdByName,
    };
  }
}
