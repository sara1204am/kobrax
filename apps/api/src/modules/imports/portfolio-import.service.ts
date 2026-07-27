import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ClientType, CreditStatus } from '@prisma/client';
import { CreditOrigin, readCreditMetadata } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { parsePdfBlocks, type ColumnCandidate, type FieldMap } from './parsers/pdf-blocks.parser';
import { parseCsvRows } from './parsers/rows.parser';
import { FIELD_CATALOG, normalizeRecord, type NormalizedRecord } from './field-catalog';
import {
  DEFAULT_IMPORT_CONFIG,
  detectFileShape,
  ImportConfigError,
  mergeFieldPatch,
  readImportConfig,
  requiredFields,
  scopeLabel,
  toFieldMap,
  validateImportConfig,
  type ImportConfig,
  type ImportConfigPatch,
} from './import-config';
import { planPortfolioImport, type ExistingCredit, type PortfolioRow } from './portfolio-plan';

/** La config del tenant + lo derivado que necesita una corrida. */
interface RunConfig extends ImportConfig {
  fieldMap: FieldMap;
  required: string[];
}

interface LastRun {
  at: string;
  template: string | null;
  scope: string | null;
  created: number;
  updated: number;
  setCurrent: number;
  errors: number;
}

/** Candidatos de `scope.ref` para la pantalla de Ajustes (FIELD-RULES §6.4). */
interface ScopeMember {
  id: string;
  name: string;
  role: string;
}

interface ScopeBranch {
  id: string;
  name: string;
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
    // Advertencias que NO frenan la fila (§5): la fila se importa igual y se avisa.
    warnings: { index?: number; code: string; detail?: string }[];
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
    assertRunnable(config);
    assertFileShape(file, config.profile.kind);

    // Parseo server-side (fuera de la transacción), con el motor que pida el perfil.
    // Errores de lectura (firma, tope anti-DoS, archivo corrupto) → 400, no 500.
    let blocks: NormalizedRecord[];
    try {
      const { profile, fieldMap } = config;
      const raw =
        profile.kind === 'rows'
          ? parseCsvRows(file.toString('utf8'), profile, fieldMap).records
          : (await parsePdfBlocks(new Uint8Array(file), profile, fieldMap)).records;
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
      // `account` = el archivo cubre TODA la cuenta → no filtra por agencia ni por oficial (§2.4).
      const inScope = (c: { branchId: string | null; assignedManagerId: string | null }): boolean =>
        scope.kind === 'account'
          ? true
          : scope.kind === 'official'
            ? c.assignedManagerId === scope.ref
            : c.branchId === scope.ref;
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
      const plan = planPortfolioImport(rows, existingCredits, {
        absentRule: config.absentRule === 'ask' ? 'no-touch' : config.absentRule,
        required: config.required,
      });

      const preview: PortfolioSummary['preview'] = {
        toCreate: plan.toCreate.map((r) => ({ code: r.code, clientName: clientLabel(r.data as unknown as NormalizedRecord) })),
        toUpdate: plan.toUpdate.map((u) => ({ code: u.row.code })),
        toSetCurrent: plan.toSetCurrent.map((id) => ({ code: codeById.get(id) ?? null })),
        invalid: plan.invalid,
        warnings: moraWarnings(blocks, config),
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
          // Sin `ref` (alcance de empresa) se guarda la clase a secas: `${kind}:${ref}` escribía
          // literalmente "account:null" en el historial, que además ahora se le muestra al usuario
          // en la tarjeta de última importación (FIELD-RULES §8 · item 14).
          scope: scopeLabel(scope),
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
        after: { template: config.profile.kind, scope: scopeLabel(scope), ...result.counts },
      });
    }
    return { dryRun, scope, ...result };
  }

  // ── Configuración (N3) ─────────────────────────────────────────────────────

  /** Todo lo que la pantalla de Ajustes necesita para dibujarse, en una sola llamada (§6). */
  async getConfigScreen(): Promise<{
    config: ImportConfig;
    catalog: typeof FIELD_CATALOG;
    lastRun: LastRun | null;
    members: ScopeMember[];
    branches: ScopeBranch[];
  }> {
    const accountId = this.tenant.accountId;
    // `members` y `branches` son lo que la pantalla ofrece al elegir el alcance (FIELD-RULES §6.4):
    // sin ellos, `scope.kind` official/branch queda sin `ref` y el asistente no puede avanzar.
    // Viajan acá y no en endpoints propios porque no existe módulo `users` ni `branches`, y montar
    // dos módulos para dos listas de nombres no se paga: esta llamada ya dibuja la pantalla entera.
    const [account, run, members, branches] = await this.tx((tx) =>
      Promise.all([
        tx.account.findUnique({ where: { id: accountId } }),
        tx.clientImportRun.findFirst({
          where: { accountId, source: 'portfolio' },
          orderBy: { createdAt: 'desc' },
        }),
        tx.userAccount.findMany({
          where: { isActive: true },
          include: { role: { select: { name: true } }, user: { include: { profile: true } } },
        }),
        tx.branch.findMany({
          where: { accountId, active: true, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]),
    );
    return {
      config: readImportConfig((account?.configuration as { importConfig?: unknown })?.importConfig),
      catalog: FIELD_CATALOG,
      lastRun: run
        ? {
            at: run.createdAt.toISOString(),
            template: run.template,
            scope: run.scope,
            created: run.creditsCreated,
            updated: run.creditsUpdated,
            setCurrent: run.creditsSetCurrent,
            errors: run.errors,
          }
        : null,
      // Se devuelven TODOS los miembros activos con su rol, sin filtrar por COLLECTOR: quien lleva
      // la cartera se llama distinto en cada tenant (oficial de crédito, gestor, cobrador) y
      // filtrar acá dejaría al banco sin poder elegir a su oficial. El rol viaja como etiqueta.
      members: members
        .map((m) => ({
          id: m.userId,
          name: m.user.profile ? `${m.user.profile.firstName} ${m.user.profile.lastName}` : m.user.email,
          role: m.role.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      branches,
    };
  }

  /**
   * Guarda un cambio de configuración. Valida los invariantes de §3.1 **acá**, no sólo en la UI:
   * la config vive en un JSONB sin esquema, y una regla contradictoria guardada se convierte en
   * una cartera mal importada. Merge superficial: la pantalla guarda campo por campo.
   */
  async patchConfig(patch: ImportConfigPatch): Promise<{ config: ImportConfig }> {
    const accountId = this.tenant.accountId;
    const account = await this.tx((tx) => tx.account.findUnique({ where: { id: accountId } }));
    const configuration = (account?.configuration ?? {}) as Record<string, unknown>;
    const prev = readImportConfig(configuration.importConfig);

    let next: ImportConfig;
    try {
      // Reiniciar es reemplazo, no merge: mergear los defaults sobre lo guardado dejaría los
      // `fields` viejos y una config a medio camino, que es peor que la que se quería tirar.
      next = patch.reset
        ? { ...DEFAULT_IMPORT_CONFIG, fields: {} }
        : readImportConfig({
            ...prev,
            ...patch,
            profile: { ...prev.profile, ...patch.profile },
            scope: patch.scope ? { ...patch.scope } : prev.scope,
            // Cambiar la forma del archivo tira los emparejados: las etiquetas de un formato no
            // significan nada en el otro (invariante 4). Se resetea acá para que el usuario no
            // tenga que borrarlos a mano y para que el invariante no sea sólo un error.
            fields:
              patch.profile?.kind && patch.profile.kind !== prev.profile.kind
                ? {}
                : mergeFieldPatch(prev.fields, patch.fields),
          });
      validateImportConfig(next, prev);
    } catch (e) {
      if (e instanceof ImportConfigError) throw new BadRequestException({ code: e.code, message: e.message });
      throw e;
    }

    await this.tx((tx) =>
      tx.account.update({
        where: { id: accountId },
        data: { configuration: { ...configuration, importConfig: next } as unknown as Prisma.InputJsonValue },
      }),
    );
    await this.audit.record({ entity: 'import_config', entityId: accountId, action: 'UPDATE', after: next });
    return { config: next };
  }

  /**
   * Qué etiquetas/columnas trae un archivo de muestra, sin correr el reconcile (§6.5).
   * Es lo que hace posible configurar un formato que nunca vimos: el usuario sube SU archivo y
   * la app le muestra lo que encontró para que empareje.
   */
  async readColumns(file: Buffer): Promise<{
    labels: string[];
    columnCandidates: ColumnCandidate[];
    recordStartCandidates: { text: string; count: number }[];
  }> {
    const config = await this.importConfig();
    assertFileShape(file, config.profile.kind);
    try {
      if (config.profile.kind === 'rows') {
        const { labels, columnCandidates } = parseCsvRows(file.toString('utf8'), config.profile, config.fieldMap);
        // Una planilla no tiene "dónde empieza cada registro": cada fila es un registro.
        return { labels, columnCandidates, recordStartCandidates: [] };
      }
      const { labels, columnCandidates, recordStartCandidates } = await parsePdfBlocks(
        new Uint8Array(file),
        config.profile,
        config.fieldMap,
      );
      return { labels, columnCandidates, recordStartCandidates };
    } catch (e) {
      throw new BadRequestException({
        code: 'PARSE_FAILED',
        message: e instanceof Error ? e.message : 'No se pudo leer el archivo',
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async importConfig(): Promise<RunConfig> {
    const account = await this.tx((tx) => tx.account.findUnique({ where: { id: this.tenant.accountId } }));
    const cfg = readImportConfig((account?.configuration as { importConfig?: unknown })?.importConfig);

    // Sin guardas acá: esta función la comparten la corrida y la LECTURA DE UNA MUESTRA, y leer
    // una muestra es precisamente lo que se hace cuando todavía no hay nada configurado. Lo que
    // exige config es importar, así que la exigencia vive en `run()` (ver `assertRunnable`).
    return { ...cfg, fieldMap: toFieldMap(cfg.fields), required: requiredFields(cfg.fields) };
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
/**
 * Lo que hace falta para APLICAR un archivo — no para leer una muestra.
 *
 * Acá vivía un fallback al formato de un banco concreto: un tenant sin `fields` importaba con esa
 * configuración sin haberla pedido, incluido el que acababa de reiniciar la suya. Ahora se dice
 * qué falta y dónde se arregla, que es lo que el usuario necesita (C12).
 */
function assertRunnable(config: RunConfig): void {
  if (Object.keys(config.fieldMap).length === 0) {
    throw new BadRequestException({
      code: 'IMPORT_NOT_CONFIGURED',
      message: 'Todavía no emparejaste ningún campo. Andá a Ajustes › Importación › Emparejar columnas.',
    });
  }
  if (config.scope.kind !== 'account' && !config.scope.ref) {
    throw new BadRequestException({ code: 'IMPORT_NOT_CONFIGURED', message: 'Falta el alcance del archivo' });
  }
}

/**
 * El archivo tiene que ser de la forma configurada. Leer un PDF con el parser de planillas no
 * explota: devuelve `%PDF-1.1` como si fuera la única columna del archivo, y el usuario se queda
 * mirando una pantalla que no le dice nada. El mensaje nombra el arreglo, que está en Ajustes.
 */
function assertFileShape(file: Buffer, kind: ImportConfig['profile']['kind']): void {
  const shape = detectFileShape(file);
  if (shape === 'pdf' && kind !== 'pdf-blocks') {
    throw new BadRequestException({
      code: 'FILE_SHAPE_MISMATCH',
      message: 'Subiste un PDF, pero la configuración dice Excel/CSV. Cambiá "Forma del archivo" en Ajustes › Importación.',
    });
  }
  if (shape === 'zip') {
    // Todo lo que empaqueta en zip es una planilla binaria (.xlsx, .ods). Dos motivos distintos
    // para frenar acá, y el mensaje dice cuál es: o el perfil es PDF, o es el correcto pero
    // todavía no sabemos abrir Excel — la dep `xlsx` no está instalada y `parseCsvRows` leería
    // los bytes del zip como si fueran texto (mismo defecto que el `%PDF-1.1`).
    throw new BadRequestException({
      code: kind === 'pdf-blocks' ? 'FILE_SHAPE_MISMATCH' : 'XLSX_NOT_SUPPORTED',
      message:
        kind === 'pdf-blocks'
          ? 'Subiste una planilla, pero la configuración dice extracto PDF. Cambiá "Forma del archivo" en Ajustes › Importación.'
          : 'Todavía no se leen archivos de Excel. Guardá la planilla como CSV y subí ese archivo.',
    });
  }
}

function clientLabel(b: NormalizedRecord): string {
  return [b.clientLastName, b.clientFirstName].filter(Boolean).join(' ') || 'SIN NOMBRE';
}

/** Umbral a partir del cual la sospecha deja de ser "un caso raro" y pasa a ser "la columna está mal". */
const MORA_ALERT_RATIO = 0.2;

/**
 * Guardas de la columna de días de atraso (§5, §6.5.1). **Advierten, no rechazan**: la fila se
 * importa igual. Frenar por sospecha convertiría un layout raro del banco en una cartera que no
 * entra nunca; avisar deja que el usuario mire y corrija la columna en Ajustes.
 */
function moraWarnings(blocks: NormalizedRecord[], config: RunConfig): PortfolioSummary['preview']['warnings'] {
  const out: PortfolioSummary['preview']['warnings'] = [];
  const rule = config.fields.daysPastDue;
  if (rule?.from && rule.enabled !== false && !rule.calibrated) {
    out.push({ code: 'MORA_SIN_CONFIRMAR', detail: rule.from });
  }
  // Vigente + sin monto en mora, pero con días de atraso: o es un caso raro, o la columna
  // elegida no son los días de mora (`Dias Int.` cae contigua a `Dias Mora`).
  const sospechosas = blocks
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => (b.daysPastDue ?? 0) > 0 && b.pastDueAmount === 0 && mapStatus(b.status) === CreditStatus.ACTIVE);
  for (const { index } of sospechosas) out.push({ index, code: 'MORA_INCONSISTENTE' });
  if (blocks.length > 0 && sospechosas.length / blocks.length > MORA_ALERT_RATIO) {
    out.push({ code: 'MORA_COLUMNA_SOSPECHOSA', detail: `${sospechosas.length}/${blocks.length}` });
  }
  return out;
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
  return { toCreate: [], toUpdate: [], toSetCurrent: [], invalid: [], warnings: [] };
}
