import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@kobrax/database';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../context/tenant-context.service';
import { redactPII } from './redact';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | string;

export interface AuditEntry {
  entity: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  /** Claves PII adicionales a redactar, según la entidad. */
  redactKeys?: string[];
}

/**
 * Escribe el audit trail append-only (`audit_logs`). Toma `accountId`/`userId`/`ip`
 * del `TenantContextService`. Redacta PII en los snapshots `before/after`.
 * Si no hay contexto de tenant (request no autenticado) → no audita (la tabla exige `account_id`).
 */
/**
 * Quién actuó. Un usuario de la cuenta va por `userId`; la persona de plataforma (sesión de soporte) NO es un usuario de empresa: `userId` queda nulo y el
 * rastro lleva `actorType = PLATFORM`, su id y la sesión de soporte (F14 · F5).
 */
function actorOf(ctx: { userId: string; actorType?: 'PLATFORM'; supportSessionId?: string }) {
  return ctx.actorType === 'PLATFORM'
    ? { userId: null, actorType: 'PLATFORM' as const, actorId: ctx.userId, supportSessionId: ctx.supportSessionId ?? null }
    : { userId: ctx.userId };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = this.tenantContext.get();
    if (!ctx) return; // sin tenant no se puede auditar

    const before = entry.before === undefined ? undefined : redactPII(entry.before, entry.redactKeys);
    const after = entry.after === undefined ? undefined : redactPII(entry.after, entry.redactKeys);

    try {
      await this.prisma.withTenant(ctx.accountId, (tx) =>
        tx.auditLog.create({
          data: {
            accountId: ctx.accountId,
            ...actorOf(ctx),
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId,
            before: before as Prisma.InputJsonValue | undefined,
            after: after as Prisma.InputJsonValue | undefined,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
        }),
      );
    } catch (err) {
      // El fallo de auditoría no debe romper la operación de negocio; se loguea sin PII.
      this.logger.error(`No se pudo registrar audit ${entry.action} ${entry.entity}#${entry.entityId}`);
      void err;
    }
  }

  /**
   * Muchas entradas en una sola escritura. Para lo que genera una importación: un evento por crédito
   * que apareció, faltó o volvió, que en un reporte de miles de filas serían miles de inserts sueltos.
   * Mismas reglas que `record`: contexto del tenant, PII redactada, y un fallo no rompe la operación.
   */
  async recordMany(entries: AuditEntry[]): Promise<void> {
    const ctx = this.tenantContext.get();
    if (!ctx || entries.length === 0) return;

    const data = entries.map((entry) => ({
      accountId: ctx.accountId,
      ...actorOf(ctx),
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: (entry.before === undefined ? undefined : redactPII(entry.before, entry.redactKeys)) as Prisma.InputJsonValue | undefined,
      after: (entry.after === undefined ? undefined : redactPII(entry.after, entry.redactKeys)) as Prisma.InputJsonValue | undefined,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    }));
    try {
      await this.prisma.withTenant(ctx.accountId, (tx) => tx.auditLog.createMany({ data }));
    } catch (err) {
      this.logger.error(`No se pudieron registrar ${entries.length} entradas de audit (${entries[0]!.entity})`);
      void err;
    }
  }
}
