import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ClientType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { BlindIndexService } from '../../../common/crypto/blind-index.service';
import { AuditService } from '../../../common/audit/audit.service';
import { parseCsv } from './csv';
import { planImport, type ImportRow } from './import-plan';
import { ImportClientsDto } from './import.dto';

/** Campos canónicos del cliente que la importación puede mapear. */
const FIELDS = ['firstName', 'lastName', 'businessName', 'nationalId', 'taxId', 'riskSegment', 'clientType', 'gender'] as const;

interface Counts {
  created: number;
  updated: number;
  softDeleted: number;
  needsReview: number;
  errors: number;
}

interface TxResult extends Counts {
  idempotentSkip: boolean;
  runId?: string;
  invalid: { index: number; reason: string }[];
}

interface ImportSummary extends Counts {
  dryRun: boolean;
  idempotentSkip: boolean;
  runId?: string;
  invalid: { index: number; reason: string }[];
}

@Injectable()
export class ClientImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly crypto: CryptoService,
    private readonly blind: BlindIndexService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async run(dto: ImportClientsDto): Promise<ImportSummary> {
    const records = this.extractRecords(dto);
    const fileHash = createHash('sha256')
      .update(dto.source === 'csv' ? (dto.content ?? '') : JSON.stringify(dto.rows ?? []))
      .digest('hex');

    // Mapeo + validación por fila (no aborta el lote: las inválidas se reportan).
    const rows: ImportRow[] = [];
    const invalid: { index: number; reason: string }[] = [];
    records.forEach((raw, i) => {
      const mapped = this.mapRecord(raw, dto.mapping);
      const reason = this.validate(mapped);
      if (reason) {
        invalid.push({ index: i, reason });
        return;
      }
      rows.push({ index: i, documentHash: this.blind.hash(mapped.nationalId as string | undefined), data: mapped });
    });

    const accountId = this.tenant.accountId;

    const result: TxResult = await this.tx(async (tx) => {
      // Idempotencia: el mismo archivo ya aplicado → no-op.
      if (!dto.dryRun) {
        const prev = await tx.clientImportRun.findFirst({ where: { fileHash, status: 'DONE' } });
        if (prev) {
          return { idempotentSkip: true, runId: prev.id, invalid: [], created: prev.created, updated: prev.updated, softDeleted: prev.softDeleted, needsReview: prev.needsReview, errors: prev.errors };
        }
      }

      const existing = await tx.client.findMany({ where: { deletedAt: null }, select: { id: true, nationalIdHash: true } });
      const activeCredits = await tx.credit.findMany({ where: { status: 'ACTIVE', deletedAt: null }, select: { clientId: true }, distinct: ['clientId'] });
      const plan = planImport(rows, existing, {
        mode: dto.mode,
        activeObligationIds: new Set(activeCredits.map((c) => c.clientId)),
      });
      plan.invalid.push(...invalid); // dups dentro del archivo + inválidas de validación
      const c = this.counts(plan);

      if (dto.dryRun) {
        return { idempotentSkip: false, invalid: plan.invalid, ...c };
      }

      // Aplicar (atómico dentro del tenant).
      for (const row of plan.toCreate) await this.createClient(tx, accountId, row);
      for (const u of plan.toUpdate) await this.updateClient(tx, u.id, u.row);
      if (plan.toSoftDelete.length > 0) {
        await tx.client.updateMany({
          where: { id: { in: plan.toSoftDelete } },
          data: { status: 'INACTIVE', deletedAt: new Date() },
        });
      }

      const run = await tx.clientImportRun.create({
        data: {
          accountId,
          source: dto.source,
          fileHash,
          mode: dto.mode,
          mapping: (dto.mapping ?? {}) as Prisma.InputJsonValue,
          status: 'DONE',
          created: c.created,
          updated: c.updated,
          softDeleted: c.softDeleted,
          needsReview: c.needsReview,
          errors: c.errors,
          createdBy: this.tenant.userId,
        },
      });
      return { idempotentSkip: false, runId: run.id, invalid: plan.invalid, ...c };
    });

    if (!dto.dryRun && !result.idempotentSkip) {
      await this.audit.record({
        entity: 'client_import',
        entityId: result.runId ?? fileHash,
        action: 'IMPORT',
        after: { mode: dto.mode, created: result.created, updated: result.updated, softDeleted: result.softDeleted, needsReview: result.needsReview, errors: result.errors },
      });
    }
    return { dryRun: !!dto.dryRun, ...result };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private extractRecords(dto: ImportClientsDto): Record<string, unknown>[] {
    if (dto.source === 'csv') {
      if (!dto.content) throw new BadRequestException({ code: 'IMPORT_EMPTY', message: 'Falta content (CSV)' });
      return parseCsv(dto.content);
    }
    if (!Array.isArray(dto.rows)) throw new BadRequestException({ code: 'IMPORT_EMPTY', message: 'Falta rows (JSON)' });
    return dto.rows;
  }

  /** mapping = campo canónico → columna del archivo (default: identidad). */
  private mapRecord(raw: Record<string, unknown>, mapping?: Record<string, string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const col = mapping?.[field] ?? field;
      const value = raw[col];
      if (value !== undefined && value !== null && String(value).trim() !== '') out[field] = String(value).trim();
    }
    if (!out.clientType) {
      out.clientType = out.businessName && !out.firstName ? ClientType.COMPANY : ClientType.PERSON;
    }
    return out;
  }

  private validate(m: Record<string, unknown>): string | null {
    if (m.clientType === ClientType.COMPANY) return m.businessName ? null : 'COMPANY_NEEDS_BUSINESS_NAME';
    return m.firstName && m.lastName ? null : 'PERSON_NEEDS_NAME';
  }

  private async createClient(tx: PrismaClient, accountId: string, row: ImportRow): Promise<void> {
    const d = row.data;
    await tx.client.create({
      data: {
        accountId,
        clientType: d.clientType as ClientType,
        firstName: d.firstName as string | undefined,
        lastName: d.lastName as string | undefined,
        businessName: d.businessName as string | undefined,
        gender: d.gender as string | undefined,
        riskSegment: d.riskSegment as string | undefined,
        nationalId: d.nationalId ? this.crypto.encrypt(d.nationalId as string) : null,
        nationalIdHash: row.documentHash,
        taxId: d.taxId ? this.crypto.encrypt(d.taxId as string) : null,
      },
    });
  }

  private async updateClient(tx: PrismaClient, id: string, row: ImportRow): Promise<void> {
    const d = row.data;
    await tx.client.update({
      where: { id },
      data: {
        firstName: d.firstName as string | undefined,
        lastName: d.lastName as string | undefined,
        businessName: d.businessName as string | undefined,
        gender: d.gender as string | undefined,
        riskSegment: d.riskSegment as string | undefined,
        taxId: d.taxId ? this.crypto.encrypt(d.taxId as string) : undefined,
        // nationalId es la clave de emparejamiento → no se modifica en update.
      },
    });
  }

  private counts(plan: ReturnType<typeof planImport>): Counts {
    return {
      created: plan.toCreate.length,
      updated: plan.toUpdate.length,
      softDeleted: plan.toSoftDelete.length,
      needsReview: plan.needsReview.length,
      errors: plan.invalid.length,
    };
  }
}
