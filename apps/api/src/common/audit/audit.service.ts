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
            userId: ctx.userId,
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
}
