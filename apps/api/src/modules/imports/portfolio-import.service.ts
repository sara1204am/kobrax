import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ClientType, CreditStatus } from '@prisma/client';
import { CreditOrigin, readCreditMetadata } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { parsePdfBlocks, type FieldMap, type PdfBlocksProfile } from './parsers/pdf-blocks.parser';
import { parseCsvRows, type RowsProfile } from './parsers/rows.parser';
import { normalizeRecord, type NameOrder, type NormalizedRecord } from './field-catalog';
import { BANCO_UNION_PRESET } from './presets';
import { planPortfolioImport, type ExistingCredit, type PortfolioRow } from './portfolio-plan';

/**
 * Config del tenant (vive en `account.configuration.importConfig`).
 *
 * `profile` + `fields` son los que hacen genérica a la app (C12): NO hay plantilla por banco.
 * `profile.kind` elige el motor (dos, por forma de archivo) y el resto son datos que el usuario
 * configura en Ajustes. Ver FIELD-RULES §1, §3 y §4.
 */
interface ImportConfig {
  source: 'manual' | 'file';
  profile: { kind: 'pdf-blocks' | 'rows' } & PdfBlocksProfile & RowsProfile;
  fields: FieldMap;
  nameOrder: NameOrder;
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

    // Parseo server-side (fuera de la transacción), con el motor que pida el perfil.
    // Errores de lectura (firma, tope anti-DoS, archivo corrupto) → 400, no 500.
    let blocks: NormalizedRecord[];
    try {
      const { profile, fields } = config;
      const raw =
        profile.kind === 'rows'
          ? parseCsvRows(file.toString('utf8'), profile, fields).records
          : (await parsePdfBlocks(new Uint8Array(file), profile, fields)).records;
      blocks = raw.map((r) => normalizeRecord(r, config.nameOrder));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No se pudo leer el archivo';
      const code = message.includes('SIGNATURE_MISMATCH') ? 'SIGNATURE_MISMATCH' : 'PARSE_FAILED';
      throw new BadRequestException({ code, message });
    }
    // Cero registros con un archivo que se leyó = el PERFIL está mal, no el archivo. El mensaje
    // manda a Ajustes en vez de acusar al usuario de subir algo inválido (FIELD-RULES §5).
    if (blocks.length === 0) {
      throw new BadRequestException({
        code: 'NO_RECORDS_MAPPED',
        message: 'No se encontró ningún crédito. Revisá la configuración de lectura del archivo.',
      });
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

      const rows: PortfolioRow[] = blocks.map((b, index) => ({
        index,
        code: b.code ?? '',
        data: b as unknown as Record<string, unknown>,
      }));
      const plan = planPortfolioImport(rows, existingCredits, { absentRule: config.absentRule });

      const preview: PortfolioSummary['preview'] = {
        toCreate: plan.toCreate.map((r) => ({ code: r.code, clientName: clientLabel(r.data as unknown as NormalizedRecord) })),
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
          const b = r.data as unknown as NormalizedRecord;
          // El archivo no trae carnet → cliente sin nationalId. El corte apellido/nombre lo decidió
          // el usuario con `nameOrder` (§2.3): acá ya viene resuelto por `normalizeRecord`.
          const clientId = randomUUID();
          clientsData.push({
            id: clientId,
            accountId,
            clientType: ClientType.PERSON,
            lastName: b.clientLastName ?? 'SIN NOMBRE',
            firstName: b.clientFirstName ?? undefined,
          });
          creditsData.push(creditCreateData(accountId, clientId, b, scope));
        }
        await tx.client.createMany({ data: clientsData });
        await tx.credit.createMany({ data: creditsData });
      }
      for (const u of plan.toUpdate) {
        await this.updateCredit(tx, u.id, u.row.data as unknown as NormalizedRecord, metaById.get(u.id) ?? {});
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
          template: config.profile.kind,
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
        after: { template: config.profile.kind, scope: `${scope.kind}:${scope.ref}`, ...result.counts },
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
    // Sin `profile`/`fields` configurados se cae al preset del Banco Unión: es lo que ya usaban
    // los tenants de FUNDACION. ponytail: es un default de compatibilidad, no un caso especial en
    // el código — el preset es un dato como cualquier otro (C12), y S1 lo va a pisar con lo que
    // el usuario configure.
    return {
      source: cfg.source ?? 'file',
      profile: cfg.profile ?? { kind: 'pdf-blocks', ...BANCO_UNION_PRESET.profile },
      fields: cfg.fields ?? BANCO_UNION_PRESET.fields,
      nameOrder: cfg.nameOrder ?? 'full',
      scope: cfg.scope,
      absentRule: cfg.absentRule ?? 'set-current',
    };
  }

  private async updateCredit(tx: PrismaClient, id: string, b: NormalizedRecord, prevMeta: Record<string, unknown>): Promise<void> {
    await tx.credit.update({
      where: { id },
      data: {
        outstandingBalance: b.outstandingBalance ?? undefined,
        // `null` = el parser no encontró la columna → NO se escribe. Escribirla siempre haría que
        // un archivo con otro layout ponga la cartera entera en 0 días de mora (§2.1 del plan).
        daysPastDue: b.daysPastDue ?? undefined,
        // Estado desconocido (no mapeado) → NO tocar el status: evita degradar silenciosamente
        // un DEFAULTED/WRITTEN_OFF a ACTIVE en cada import (la tabla de equivalencias completa = web).
        status: mapStatus(b.status) ?? undefined,
        interestRate: b.interestRate ?? undefined,
        metadata: {
          ...prevMeta,
          origin: CreditOrigin.IMPORT,
          coHolder: b.coHolder ?? prevMeta.coHolder,
          pastDueAmount: b.pastDueAmount ?? prevMeta.pastDueAmount,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

/** Cómo se muestra el cliente en la Vista Previa. */
function clientLabel(b: NormalizedRecord): string {
  return [b.clientLastName, b.clientFirstName].filter(Boolean).join(' ') || 'SIN NOMBRE';
}

/** Datos de un crédito nuevo para `createMany` (el archivo no trae carnet → cliente sin nationalId). */
function creditCreateData(
  accountId: string,
  clientId: string,
  b: NormalizedRecord,
  scope: ImportConfig['scope'],
): Prisma.CreditCreateManyInput {
  return {
    accountId,
    clientId,
    code: b.code ?? undefined,
    principalAmount: b.principalAmount ?? 0,
    outstandingBalance: b.outstandingBalance ?? 0,
    interestRate: b.interestRate ?? 0,
    currency: mapCurrency(b.currency),
    status: mapStatus(b.status) ?? CreditStatus.ACTIVE, // crédito nuevo: default razonable si el estado no se mapea
    daysPastDue: b.daysPastDue ?? 0, // la columna es NOT NULL: el default aplica sólo al CREAR
    branchId: scope.kind === 'branch' ? scope.ref : undefined,
    assignedManagerId: scope.kind === 'official' ? scope.ref : undefined,
    disbursedAt: b.disbursedAt ? new Date(b.disbursedAt) : undefined,
    metadata: {
      origin: CreditOrigin.IMPORT,
      coHolder: b.coHolder ?? undefined,
      pastDueAmount: b.pastDueAmount ?? undefined,
    } as Prisma.InputJsonValue,
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
function mapStatus(raw: string | null): CreditStatus | null {
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
