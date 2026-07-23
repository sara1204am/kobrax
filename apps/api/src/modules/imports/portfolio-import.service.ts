import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ClientType, CreditStatus } from '@prisma/client';
import { CreditOrigin, readCreditMetadata } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { parseBancoUnionPdf, type ParsedCreditBlock } from './parsers/banco-union.parser';
import { planPortfolioImport, type ExistingCredit, type PortfolioRow } from './portfolio-plan';

/** Config corta del tenant (vive en `account.configuration.importConfig`; la completa es web). */
interface ImportConfig {
  source: 'manual' | 'file';
  template: 'banco-union-pdf' | 'csv' | 'xlsx';
  scope: { kind: 'official' | 'branch'; ref: string };
  absentRule: 'set-current' | 'no-touch';
}

interface PortfolioSummary {
  dryRun: boolean;
  idempotentSkip: boolean;
  runId?: string;
  scope: ImportConfig['scope'];
  counts: { created: number; updated: number; setCurrent: number; invalid: number };
  // Baldes para la Vista Previa (obligatoria antes de confirmar). "Eliminados" no existe: nunca borra.
  preview: {
    toCreate: { code: string; clientName: string }[];
    toUpdate: { code: string }[];
    toSetCurrent: { code: string | null }[];
    invalid: { index: number; reason: string }[];
  };
}

@Injectable()
export class PortfolioImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async run(file: Buffer, dryRun: boolean): Promise<PortfolioSummary> {
    const config = await this.importConfig();
    if (config.source === 'manual') {
      throw new BadRequestException({ code: 'IMPORT_DISABLED', message: 'El tenant carga a mano (source=manual)' });
    }

    // Parseo server-side (fuera de la transacción). Por ahora solo la plantilla Banco Unión;
    // ponytail: csv/xlsx se enchufan cuando aterrice el slice de settings (reusan csv.ts).
    if (config.template !== 'banco-union-pdf') {
      throw new BadRequestException({ code: 'TEMPLATE_NOT_IMPLEMENTED', message: `Plantilla ${config.template} pendiente` });
    }
    // Errores del parser (plantilla equivocada, tope anti-DoS, PDF corrupto) → 400, no 500.
    let blocks: ParsedCreditBlock[];
    try {
      blocks = (await parseBancoUnionPdf(new Uint8Array(file))).blocks;
    } catch (e) {
      throw new BadRequestException({ code: 'PARSE_FAILED', message: e instanceof Error ? e.message : 'No se pudo parsear el archivo' });
    }

    const fileHash = createHash('sha256').update(file).digest('hex');
    const accountId = this.tenant.accountId;
    const scope = config.scope;

    const result = await this.tx(async (tx) => {
      // Idempotencia: mismo archivo ya aplicado → no-op.
      if (!dryRun) {
        const prev = await tx.clientImportRun.findFirst({ where: { accountId, fileHash, status: 'DONE', template: { not: null } } });
        if (prev) {
          return {
            idempotentSkip: true,
            runId: prev.id,
            counts: { created: prev.creditsCreated, updated: prev.creditsUpdated, setCurrent: prev.creditsSetCurrent, invalid: prev.errors },
            preview: emptyPreview(),
          };
        }
      }

      // Existentes de la CUENTA ENTERA (todo scope, incl. borrados). El `@@unique([accountId,code])`
      // es account-wide → el matching de colisión DEBE cubrir ese dominio: si filtrara por scope o
      // por `deletedAt: null`, un code fuera de alcance o soft-deleted caería en toCreate y estallaría
      // con P2002 abortando la corrida entera. `eligible` = activo (no borrado) y dentro del alcance
      // → único candidato real a update / set-current (D-SCOPE).
      const inScope = (c: { branchId: string | null; assignedManagerId: string | null }): boolean =>
        scope.kind === 'official' ? c.assignedManagerId === scope.ref : c.branchId === scope.ref;
      const existing = await tx.credit.findMany({
        where: { accountId },
        select: { id: true, code: true, deletedAt: true, branchId: true, assignedManagerId: true, metadata: true },
      });
      const metaById = new Map(existing.map((c) => [c.id, (c.metadata ?? {}) as Record<string, unknown>]));
      const codeById = new Map(existing.map((c) => [c.id, c.code]));
      const existingCredits: ExistingCredit[] = existing.map((c) => ({
        id: c.id,
        code: c.code,
        origin: readCreditMetadata(c.metadata).origin,
        eligible: c.deletedAt === null && inScope(c),
      }));

      const rows: PortfolioRow[] = blocks.map((b, index) => ({ index, code: b.code, data: b as unknown as Record<string, unknown> }));
      const plan = planPortfolioImport(rows, existingCredits, { absentRule: config.absentRule });

      const preview: PortfolioSummary['preview'] = {
        toCreate: plan.toCreate.map((r) => ({ code: r.code, clientName: (r.data as unknown as ParsedCreditBlock).clientName })),
        toUpdate: plan.toUpdate.map((u) => ({ code: u.row.code })),
        toSetCurrent: plan.toSetCurrent.map((id) => ({ code: codeById.get(id) ?? null })),
        invalid: plan.invalid,
      };
      const counts = {
        created: plan.toCreate.length,
        updated: plan.toUpdate.length,
        setCurrent: plan.toSetCurrent.length,
        invalid: plan.invalid.length,
      };

      if (dryRun) return { idempotentSkip: false, counts, preview };

      // Aplicar (atómico dentro del tenant). NUNCA borra (§4 del plan).
      // Create batcheado: 2 createMany (clientes + créditos) en vez de 2N inserts en serie —
      // un extracto de banco puede traer miles de créditos. Los ids de cliente se pre-generan
      // en app para enlazar crédito↔cliente sin depender del id devuelto por cada insert.
      if (plan.toCreate.length > 0) {
        const clientsData: Prisma.ClientCreateManyInput[] = [];
        const creditsData: Prisma.CreditCreateManyInput[] = [];
        for (const r of plan.toCreate) {
          const b = r.data as unknown as ParsedCreditBlock;
          // El extracto no trae carnet → cliente sin nationalId. ponytail: el nombre no se separa
          // apellido/nombre (el extracto no lo delimita); se guarda entero en firstName.
          const clientId = randomUUID();
          clientsData.push({ id: clientId, accountId, clientType: ClientType.PERSON, firstName: b.clientName || 'SIN NOMBRE' });
          creditsData.push(creditCreateData(accountId, clientId, b, scope));
        }
        await tx.client.createMany({ data: clientsData });
        await tx.credit.createMany({ data: creditsData });
      }
      for (const u of plan.toUpdate) {
        await this.updateCredit(tx, u.id, u.row.data as unknown as ParsedCreditBlock, metaById.get(u.id) ?? {});
      }
      if (plan.toSetCurrent.length > 0) {
        // Ausente del archivo → al día. Saldo INTACTO (pagó la cuota, no el crédito).
        await tx.credit.updateMany({
          where: { id: { in: plan.toSetCurrent } },
          data: { daysPastDue: 0, status: CreditStatus.ACTIVE },
        });
      }

      const run = await tx.clientImportRun.create({
        data: {
          accountId,
          source: 'portfolio',
          fileHash,
          mode: 'RECONCILE',
          status: 'DONE',
          template: config.template,
          scope: `${scope.kind}:${scope.ref}`,
          creditsCreated: counts.created,
          creditsUpdated: counts.updated,
          creditsSetCurrent: counts.setCurrent,
          errors: counts.invalid,
          createdBy: this.tenant.userId,
        },
      });
      return { idempotentSkip: false, runId: run.id, counts, preview };
    });

    if (!dryRun && !result.idempotentSkip) {
      await this.audit.record({
        entity: 'portfolio_import',
        entityId: result.runId ?? fileHash,
        action: 'IMPORT',
        after: { template: config.template, scope: `${scope.kind}:${scope.ref}`, ...result.counts },
      });
    }
    return { dryRun, scope, ...result };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async importConfig(): Promise<ImportConfig> {
    const account = await this.tx((tx) => tx.account.findUnique({ where: { id: this.tenant.accountId } }));
    const cfg = ((account?.configuration ?? {}) as { importConfig?: Partial<ImportConfig> }).importConfig;
    if (!cfg?.scope?.ref) {
      throw new BadRequestException({ code: 'IMPORT_NOT_CONFIGURED', message: 'Falta importConfig del tenant' });
    }
    return {
      source: cfg.source ?? 'file',
      template: cfg.template ?? 'banco-union-pdf',
      scope: cfg.scope,
      absentRule: cfg.absentRule ?? 'set-current',
    };
  }

  private async updateCredit(tx: PrismaClient, id: string, b: ParsedCreditBlock, prevMeta: Record<string, unknown>): Promise<void> {
    await tx.credit.update({
      where: { id },
      data: {
        outstandingBalance: b.outstandingBalance ?? undefined,
        daysPastDue: b.daysPastDue,
        // Estado desconocido (no mapeado) → NO tocar el status: evita degradar silenciosamente
        // un DEFAULTED/WRITTEN_OFF a ACTIVE en cada import (la tabla de equivalencias completa = web).
        status: mapStatus(b.status) ?? undefined,
        interestRate: b.interestRate ?? undefined,
        metadata: { ...prevMeta, origin: CreditOrigin.IMPORT, coHolder: b.coHolder ?? prevMeta.coHolder } as Prisma.InputJsonValue,
      },
    });
  }
}

/** Datos de un crédito nuevo para `createMany` (el extracto no trae carnet → cliente sin nationalId). */
function creditCreateData(
  accountId: string,
  clientId: string,
  b: ParsedCreditBlock,
  scope: ImportConfig['scope'],
): Prisma.CreditCreateManyInput {
  return {
    accountId,
    clientId,
    code: b.code,
    principalAmount: b.principalAmount ?? 0,
    outstandingBalance: b.outstandingBalance ?? 0,
    interestRate: b.interestRate ?? 0,
    currency: mapCurrency(b.currency),
    status: mapStatus(b.status) ?? CreditStatus.ACTIVE, // crédito nuevo: default razonable si el estado no se mapea
    daysPastDue: b.daysPastDue,
    branchId: scope.kind === 'branch' ? scope.ref : undefined,
    assignedManagerId: scope.kind === 'official' ? scope.ref : undefined,
    disbursedAt: b.disbursedAt ? new Date(b.disbursedAt) : undefined,
    metadata: { origin: CreditOrigin.IMPORT, coHolder: b.coHolder ?? undefined } as Prisma.InputJsonValue,
  };
}

// VIGENTE → ACTIVE; el resto, mapeo mínimo (la tabla completa de equivalencias es config → web).
// Devuelve null ante una etiqueta desconocida → el caller decide (preservar en update, default en create).
const STATUS_MAP: Record<string, CreditStatus> = {
  VIGENTE: CreditStatus.ACTIVE,
  VENCIDO: CreditStatus.DEFAULTED,
  CASTIGADO: CreditStatus.WRITTEN_OFF,
  CANCELADO: CreditStatus.CANCELLED,
};
function mapStatus(raw: string): CreditStatus | null {
  return STATUS_MAP[(raw ?? '').toUpperCase()] ?? null;
}
function mapCurrency(raw: string | null): string {
  if (!raw) return 'BOB';
  const u = raw.toUpperCase();
  if (u.startsWith('BOLIV')) return 'BOB';
  if (u.startsWith('DOLAR') || u.startsWith('DÓLAR')) return 'USD';
  return raw;
}
function emptyPreview(): PortfolioSummary['preview'] {
  return { toCreate: [], toUpdate: [], toSetCurrent: [], invalid: [] };
}
