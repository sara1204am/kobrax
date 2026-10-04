import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ClientType, ContactType, CreditStatus, ExternalSyncStatus, ImportRunItemAction, LocationType } from '@prisma/client';
import {
  Permission,
  readCreditMetadata,
  resolvePagination,
  ResponseDto,
  type ApiResponse,
  type ImportAssignments,
  type ImportItemValues,
  type ImportViewer,
  type ImportRunItem,
  type ImportRunSummary,
} from '@kobrax/shared';
import { UploadsService } from '../uploads/uploads.service';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { TenantClockService, civilDayStartInstant } from '../../common/context/tenant-clock.service';
import type { ListImportRunsQueryDto } from './dto/import-runs.dto';
import { AssignmentService, type AssignmentRequest } from '../assignments/assignment.service';
import type { AssignmentChange, AssignmentReason } from '../assignments/assignment-rules';
import { assigneeNotEligible, assignmentForbidden } from '../assignments/assignment.errors';
import { hasAssignments, ImportAssignmentError, planAssignments, resolveImportOwnership, type Ownership } from './import-assignment';
import { AuditService } from '../../common/audit/audit.service';
import { PlanLimitsService } from '../../common/plan/plan-limits.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BlindIndexService } from '../../common/crypto/blind-index.service';
import { parsePdfBlocks, type ColumnCandidate, type FieldMap } from './parsers/pdf-blocks.parser';
import { parsePdfRows } from './parsers/pdf-rows.parser';
import { parseRowsFile } from './parsers/rows.parser';
import { FIELD_CATALOG, normalizeRecord, splitPhones, type NormalizedRecord } from './field-catalog';
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
import {
  creditCreateData,
  creditUpdateData,
  FILE_SOURCE,
  mapStatus,
  storedStatus,
  snapshotData,
  type ImportStamp,
  type RowContext,
} from './portfolio-credit';
import { documentLines, readReportMeta, type ReportMeta } from './report-meta';
import { nameKey, resolveClients, searchWords } from './client-match';

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
  /** Fecha de corte del último reporte aplicado (YYYY-MM-DD), y de qué asesor era. */
  reportDate?: string | null;
  advisorCode?: string | null;
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

interface Counts {
  created: number;
  updated: number;
  setCurrent: number;
  invalid: number;
  /** Operaciones que faltan del reporte por primera vez (D4). */
  absent: number;
  /** Operaciones que faltaban y volvieron (D4). */
  reappeared: number;
  /** Clientes nuevos que quedan marcados «Revisar vínculo» (D2 · opción B). */
  needsReview: number;
  /** Filas que no son registros: totales y notas debajo de la tabla. */
  ignored: number;
}

interface PortfolioSummary {
  dryRun: boolean;
  idempotentSkip: boolean;
  runId?: string;
  scope: ImportConfig['scope'];
  counts: Counts;
  /** De qué fecha de corte y de qué asesor es el reporte, y a qué alcance se aplica (D8, D9). */
  report?: { reportDate: string | null; advisorCode: string | null; scope: string };
  /**
   * El tope de créditos contra lo que este archivo quiere crear. Ausente = el plan no tiene tope.
   * Va en la vista previa para poder avisar ANTES de confirmar (LIMITES §5.2, Pregunta 10).
   */
  plan?: { roomLeft: number; over: number };
  // Baldes para la Vista Previa (obligatoria antes de confirmar). "Eliminados" no existe: nunca borra.
  preview: {
    toCreate: { code: string; clientName: string; existingClient?: boolean; linkReview?: boolean; after?: ImportItemValues }[];
    toUpdate: { code: string; reappeared?: boolean; clientName?: string; before?: ImportItemValues; after?: ImportItemValues }[];
    toSetCurrent: { code: string | null; clientName?: string; before?: ImportItemValues }[];
    toMarkAbsent: { code: string | null; clientName?: string; before?: ImportItemValues }[];
    invalid: { index: number; reason: string; code?: string; clientName?: string }[];
    // Advertencias que NO frenan la fila (§5): la fila se importa igual y se avisa.
    warnings: { index?: number; code: string; detail?: string }[];
  };
}

/** Una operación que apareció, faltó o volvió: va a la auditoría como evento del crédito (§13). */
interface TransitionEvent {
  creditId: string;
  action: 'EXTERNAL_APPEARED' | 'EXTERNAL_ABSENT' | 'EXTERNAL_REAPPEARED';
  externalId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Tope de clientes candidatos que se traen para sugerir coincidencias por nombre. Una palabra muy
 * común ("MAMANI") puede traer miles; más allá de esto la sugerencia deja de servir igual.
 */
const MAX_CANDIDATES = 5000;

/** Cuántas veces aparece cada id: el reparto final que devuelve la confirmación. */
function tally(userIds: string[]): { userId: string; count: number }[] {
  const n = new Map<string, number>();
  for (const u of userIds) n.set(u, (n.get(u) ?? 0) + 1);
  return [...n].map(([userId, count]) => ({ userId, count }));
}

/** `YYYY-MM-DD` del día siguiente. En UTC a propósito: es aritmética de calendario, no de reloj. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class PortfolioImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly plan: PlanLimitsService,
    private readonly crypto: CryptoService,
    private readonly blind: BlindIndexService,
    private readonly uploads: UploadsService,
    private readonly clock: TenantClockService,
    private readonly assignment: AssignmentService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async run(
    file: Buffer,
    dryRun: boolean,
    opts: { reportDate?: string; fileName?: string; mimeType?: string; assignments?: ImportAssignments | null } = {},
  ): Promise<PortfolioSummary> {
    const config = await this.importConfig();
    if (config.source === 'manual') {
      throw new BadRequestException({ code: 'IMPORT_DISABLED', message: 'El tenant carga a mano (source=manual)' });
    }
    assertRunnable(config);
    assertFileShape(file, config.profile.kind);

    // D9: una fecha que llega a mano tiene que ser una fecha, y no del futuro.
    const explicitDate = opts.reportDate ? isoDay(opts.reportDate) : null;
    if (opts.reportDate && (!explicitDate || explicitDate > isoDay(new Date().toISOString())!)) {
      throw new BadRequestException({ code: 'INVALID_REPORT_DATE', message: 'La fecha de corte no es válida' });
    }

    // Parseo server-side (fuera de la transacción), con el motor que pida el perfil.
    // Errores de lectura (firma, tope anti-DoS, archivo corrupto) → 400, no 500.
    let blocks: NormalizedRecord[];
    let meta: ReportMeta;
    try {
      const { profile, fieldMap } = config;
      const raw = await readWithProfile(file, profile, fieldMap);
      blocks = raw.map((r) => normalizeRecord(r, config.nameOrder));
      meta = readReportMeta(await documentLines(file, profile.kind));
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

    // D9: la fecha de corte. La que se indica a mano manda sobre la del documento; sin ninguna, los
    // números se guardan igual pero sin fecha, y la vista previa lo dice.
    const reportDate = explicitDate ?? meta.reportDate ?? null;
    const reportAsOf = reportDate ? new Date(`${reportDate}T00:00:00.000Z`) : null;
    const advisorCode = meta.advisorCode;

    const fileHash = createHash('sha256').update(file).digest('hex');
    const accountId = this.tenant.accountId;

    /*
     * El documento se guarda tal cual, para verlo o descargarlo desde el historial. Va antes de la
     * transacción y no adentro: es disco, no base. Si la corrida después falla, queda un archivo sin
     * corrida —nombrado por su hash, así que subirlo de nuevo reusa el mismo lugar— y nada más.
     */
    const stored = !dryRun && opts.mimeType ? await this.uploads.storeDocument(file, opts.mimeType, 'imports') : null;

    // Quién importa decide cómo se asigna: quien reparte (`assignment:write`) elige; el cobrador no.
    const canAssign = this.assignment.canAssign();
    const me = this.tenant.userId ?? '';
    if (!canAssign && hasAssignments(opts.assignments ?? null)) throw assignmentForbidden();

    const result = await this.tx(async (tx) => {
      /*
       * Idempotencia: el mismo archivo ya aplicado no se vuelve a aplicar (P6).
       *
       * 🔴 La vista previa también lo mira, para AVISAR: antes calculaba como si fuera nuevo, todo
       * salía como «se actualizan», y las reasignaciones que alguien marcara ahí se descartaban en
       * silencio al confirmar. Confirmar con asignaciones un archivo ya aplicado es 409: reasignar
       * con un reporte viejo no es importar, se hace desde Cartera.
       */
      const prev = await tx.clientImportRun.findFirst({ where: { accountId, fileHash, status: 'DONE', template: { not: null } } });
      if (prev && !dryRun) {
        if (hasAssignments(opts.assignments ?? null)) {
          throw new ConflictException({
            code: 'ALREADY_APPLIED',
            message: 'Este archivo ya se importó. Para cambiar responsables, reasigná desde Cartera.',
            details: { runId: prev.id },
          });
        }
        return {
          idempotentSkip: true,
          runId: prev.id,
          scope: config.scope,
          counts: { ...emptyCounts(), created: prev.creditsCreated, updated: prev.creditsUpdated, setCurrent: prev.creditsSetCurrent, invalid: prev.errors },
          preview: emptyPreview(),
          transitions: [] as TransitionEvent[],
          assignmentChanges: [] as AssignmentChange[],
        };
      }
      const alreadyApplied = prev
        ? { runId: prev.id, at: prev.createdAt.toISOString(), by: prev.createdBy ? ((await this.namesIn(tx, [prev.createdBy])).get(prev.createdBy) ?? null) : null }
        : undefined;

      /*
       * D8 · El alcance efectivo, y de quién es la cartera. Un reporte que dice de qué asesor es
       * cubre SÓLO la cartera de ese asesor: lo que no trae, falta de su cartera, no de la de todos.
       * Quien no reparte sólo importa la suya (`resolveImportOwnership`).
       */
      const link = advisorCode
        ? await tx.externalAdvisorLink.findFirst({ where: { accountId, externalSource: FILE_SOURCE, advisorCode, deletedAt: null } })
        : null;
      let ownership: Ownership;
      try {
        ownership = resolveImportOwnership({ canAssign, me, advisorCode, linkedUserId: link?.userId ?? null, configScope: config.scope });
      } catch (e) {
        throw await this.ownershipError(tx, e);
      }
      const scope = ownership.scope;
      const scopeText = scopeLabel(scope);

      // D9 · Un reporte con fecha de corte anterior al último aplicado en el mismo alcance no pisa nada.
      if (reportAsOf) {
        const last = await tx.clientImportRun.findFirst({
          where: { accountId, externalSource: FILE_SOURCE, scope: scopeText, status: 'DONE', reportAsOf: { not: null } },
          orderBy: { reportAsOf: 'desc' },
        });
        if (last?.reportAsOf && reportAsOf.getTime() < last.reportAsOf.getTime()) {
          throw new BadRequestException({
            code: 'REPORT_OUTDATED',
            message: `Este reporte es del ${fmtDay(reportAsOf)} y ya se aplicó uno del ${fmtDay(last.reportAsOf)}. Un reporte más viejo no pisa datos más nuevos.`,
            details: { reportDate, lastReportDate: isoDay(last.reportAsOf.toISOString()) },
          });
        }
      }

      // Todas las operaciones externas de la cuenta (incl. borradas y de otros alcances): la identidad
      // es única en toda la cuenta, así que el match tiene que verlas a todas (ver `portfolio-plan`).
      const inScope = (c: { branchId: string | null; assignedManagerId: string | null }): boolean =>
        scope.kind === 'account' ? true : scope.kind === 'official' ? c.assignedManagerId === scope.ref : c.branchId === scope.ref;
      const existing = await tx.credit.findMany({
        where: { accountId, externalSource: FILE_SOURCE },
        select: {
          id: true,
          code: true,
          externalId: true,
          clientId: true,
          deletedAt: true,
          branchId: true,
          assignedManagerId: true,
          status: true,
          writtenOffAt: true,
          syncStatus: true,
          outstandingBalance: true,
          daysPastDue: true,
          metadata: true,
          // El nombre va al historial: una ausente no trae fila, así que su deudor sale de acá.
          client: { select: { firstName: true, lastName: true, businessName: true } },
        },
      });
      const byId = new Map(existing.map((c) => [c.id, c]));
      // Con asesor en el reporte, sus operaciones se reconocen por el asesor que ya tienen guardado;
      // las importadas antes de guardarlo, por el alcance.
      const inReportScope = (c: (typeof existing)[number]): boolean => {
        const saved = readCreditMetadata(c.metadata).externalAdvisorCode;
        return advisorCode && saved ? saved === advisorCode : inScope(c);
      };
      const existingCredits: ExistingCredit[] = existing.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        eligible: c.deletedAt === null && inReportScope(c),
        closed: c.status !== CreditStatus.ACTIVE,
        syncStatus: c.syncStatus,
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

      /*
       * Quién queda responsable. Los existentes conservan el suyo (la importación nunca lo cambia
       * sola); los nuevos van a quien importa (SELF) o a lo elegido / sugerido (CHOOSE). En la vista
       * previa no se mira lo pedido: la pantalla arranca de las sugerencias y reparte en memoria.
       */
      const currentOf = new Map(plan.toUpdate.map((u) => [u.row.code, byId.get(u.id)!.assignedManagerId] as const));
      const assignable = ownership.mode === 'CHOOSE' ? await this.assignment.assignableIds(tx) : new Set([me]);
      const assignPlan = planAssignments({
        mode: ownership.mode,
        me,
        toCreate: plan.toCreate.map((r) => r.code),
        toUpdate: currentOf,
        suggested: ownership.suggested,
        assignable,
        requested: dryRun ? null : (opts.assignments ?? null),
      });

      // D2 · A qué cliente va cada operación nueva.
      const creates = plan.toCreate.map((r) => ({ row: r, b: r.data as unknown as NormalizedRecord }));
      const idHashOf = new Map(
        creates.map((c) => [c.row.index, c.b.clientNationalId ? this.blind.hash(c.b.clientNationalId) : null] as const),
      );
      const keys = [...new Set(creates.map((c) => nameKey(clientLabel(c.b))).filter((k): k is string => k !== null))];
      const words = [...new Set(creates.flatMap((c) => searchWords(clientLabel(c.b))))];
      const hashes = [...idHashOf.values()].filter((h): h is string => !!h);
      const [linkedKeys, candidates] = await Promise.all([
        keys.length > 0
          ? tx.clientExternalKey.findMany({
              where: { accountId, externalSource: FILE_SOURCE, keyType: 'NAME', key: { in: keys }, deletedAt: null, client: { deletedAt: null } },
              select: { key: true, clientId: true },
            })
          : [],
        words.length > 0 || hashes.length > 0
          ? tx.client.findMany({
              where: {
                accountId,
                deletedAt: null,
                OR: [
                  ...words.flatMap((w) => [
                    { lastName: { contains: w, mode: 'insensitive' as const } },
                    { firstName: { contains: w, mode: 'insensitive' as const } },
                  ]),
                  ...(hashes.length > 0 ? [{ nationalIdHash: { in: hashes } }] : []),
                ],
              },
              select: { id: true, firstName: true, lastName: true, businessName: true, nationalIdHash: true },
              take: MAX_CANDIDATES,
            })
          : [],
      ]);
      const resolution = resolveClients(
        creates.map((c) => ({ index: c.row.index, fullName: clientLabel(c.b), nationalIdHash: idHashOf.get(c.row.index) })),
        { linkedByName: new Map(linkedKeys.map((k) => [k.key, k.clientId])), candidates },
      );
      const needsReview = creates.filter((c) => {
        const r = resolution.get(c.row.index);
        return r?.kind === 'new' && r.review;
      });
      const newGroups = new Set(
        creates.flatMap((c) => {
          const r = resolution.get(c.row.index);
          return r?.kind === 'new' ? [r.group] : [];
        }),
      );

      const codeOf = (id: string): string | null => byId.get(id)?.externalId ?? byId.get(id)?.code ?? null;
      // Las que no vienen en el archivo sólo se conocen por lo que ya hay en Kobrax: nombre, saldo y mora de hoy.
      const known = (id: string) => {
        const prev = byId.get(id)!;
        return { code: codeOf(id), clientName: nameOf(prev.client), before: valuesBefore(prev) };
      };
      const statusMapPreview = config.statusMap as Record<string, CreditStatus> | undefined;
      const preview: PortfolioSummary['preview'] = {
        toCreate: creates.map((c) => ({
          code: c.row.code,
          clientName: clientLabel(c.b),
          ...(resolution.get(c.row.index)?.kind === 'existing' ? { existingClient: true } : {}),
          ...(needsReview.includes(c) ? { linkReview: true } : {}),
          after: valuesOf(c.b, statusMapPreview),
          suggestedAssigneeId: assignPlan.create.get(c.row.code)?.userId ?? null,
          ...(assignPlan.create.has(c.row.code) && ownership.suggested ? { suggestionSource: ownership.suggested.source } : {}),
        })),
        toUpdate: plan.toUpdate.map((u) => ({
          code: u.row.code,
          ...(u.reappeared ? { reappeared: true } : {}),
          clientName: clientLabel(u.row.data as unknown as NormalizedRecord),
          before: valuesBefore(byId.get(u.id)!),
          after: valuesOf(u.row.data as unknown as NormalizedRecord, statusMapPreview),
          currentAssigneeId: currentOf.get(u.row.code) ?? null,
        })),
        toSetCurrent: plan.toSetCurrent.map(known),
        toMarkAbsent: plan.toMarkAbsent.map(known),
        invalid: plan.invalid.map((inv) => {
          const b = blocks[inv.index];
          return { ...inv, ...(b?.code ? { code: b.code } : {}), ...(b ? { clientName: clientLabel(b) } : {}) };
        }),
        warnings: [...moraWarnings(blocks, config), ...(reportDate ? [] : [{ code: 'REPORT_DATE_UNKNOWN' }])],
      };
      const counts = {
        created: plan.toCreate.length,
        updated: plan.toUpdate.length,
        setCurrent: plan.toSetCurrent.length,
        invalid: plan.invalid.length,
        absent: plan.toMarkAbsent.length,
        reappeared: plan.toUpdate.filter((u) => u.reappeared).length,
        needsReview: needsReview.length,
        ignored: plan.ignored,
      };
      const report = { reportDate, advisorCode: advisorCode ?? null, scope: scopeText };

      /*
       * 🔴 El tope de créditos, ANTES de escribir y también en la vista previa.
       *
       * Un archivo que se pasa se rechaza entero (LIMITES §5.2, Pregunta 10): importar «hasta
       * llenar» deja al cobrador saliendo a la calle con una cartera incompleta **sin enterarse**,
       * y el error se descubre recién cuando el deudor reclama que nunca lo visitaron.
       *
       * Que el número viaje en el `dryRun` es lo que convierte el rechazo en un aviso: la pantalla
       * puede decir «trae 500 y te quedan 80» antes de que nadie confirme nada.
       */
      const roomLeft = await this.plan.roomLeft('credits', tx);
      const planInfo = roomLeft === null ? undefined : { roomLeft, over: Math.max(0, counts.created - roomLeft) };

      const assignment = { mode: ownership.mode, selfUserId: me };
      if (dryRun) {
        return {
          idempotentSkip: false,
          scope,
          counts,
          preview,
          report,
          plan: planInfo,
          assignment,
          ...(alreadyApplied ? { alreadyApplied } : {}),
          transitions: [] as TransitionEvent[],
          assignmentChanges: [] as AssignmentChange[],
        };
      }

      // Al confirmar, el reparto se valida con el plan RECALCULADO, no con lo que vio la pantalla.
      if (assignPlan.notAssignable.length > 0) throw assigneeNotEligible(assignPlan.notAssignable);
      if (assignPlan.unassigned.length > 0) {
        throw new BadRequestException({
          code: 'UNASSIGNED_NEW_CREDITS',
          message: `Hay ${assignPlan.unassigned.length} créditos nuevos sin responsable. Asignalos antes de confirmar.`,
          details: { codes: assignPlan.unassigned },
        });
      }
      await this.plan.assertRoom('credits', tx, { cuantos: counts.created });
      await this.plan.assertRoom('clients', tx, { cuantos: newGroups.size });

      // Aplicar (atómico dentro del tenant). NUNCA borra (§4 del plan).
      // Ids pre-generados en app: enlazan crédito↔cliente y crédito↔snapshot sin depender de lo que
      // devuelva cada insert, y dejan los altas en dos `createMany` en vez de 2N inserts en serie.
      const stamp: ImportStamp = { runId: randomUUID(), at: new Date().toISOString() };
      const rowCtx: RowContext = {
        reportAsOf,
        advisorCode,
        balanceBasis: config.balanceBasis,
        statusMap: config.statusMap as Record<string, CreditStatus> | undefined,
      };
      const touched: ContactGap[] = [];
      const snapshots: Prisma.CreditExternalSnapshotCreateManyInput[] = [];
      const transitions: TransitionEvent[] = [];
      /*
       * El historial de la corrida: un movimiento por registro, con cómo estaba y cómo quedó. Se
       * escribe después de la corrida (la FK lo pide), pero se arma acá, donde se sabe qué pasó.
       */
      const items: Prisma.ClientImportRunItemCreateManyInput[] = [];
      const assignmentChanges: AssignmentChange[] = [];
      const reassignOf = new Map(assignPlan.reassign.map((r) => [r.code, { from: r.from, to: r.to }] as const));
      const item = (action: ImportRunItemAction, data: Omit<Prisma.ClientImportRunItemCreateManyInput, 'accountId' | 'runId' | 'action'>) =>
        items.push({ accountId, runId: stamp.runId, action, ...data });
      const statusMap = config.statusMap as Record<string, CreditStatus> | undefined;

      if (creates.length > 0) {
        const clientByGroup = new Map<string, string>();
        const clientsData: Prisma.ClientCreateManyInput[] = [];
        const creditsData: Prisma.CreditCreateManyInput[] = [];
        for (const { row, b } of creates) {
          const res = resolution.get(row.index)!;
          let clientId: string;
          if (res.kind === 'existing') {
            clientId = res.clientId;
          } else if (clientByGroup.has(res.group)) {
            clientId = clientByGroup.get(res.group)!;
          } else {
            clientId = randomUUID();
            clientByGroup.set(res.group, clientId);
            const hash = idHashOf.get(row.index);
            // El corte apellido/nombre lo decidió el usuario con `nameOrder` (§2.3): ya viene resuelto.
            clientsData.push({
              id: clientId,
              accountId,
              clientType: ClientType.PERSON,
              lastName: b.clientLastName ?? 'SIN NOMBRE',
              firstName: b.clientFirstName ?? undefined,
              ...(hash && b.clientNationalId ? { nationalId: this.crypto.encrypt(b.clientNationalId), nationalIdHash: hash } : {}),
              // D2 · opción B: la duda no frena la cobranza. Entra marcado y con sus sugerencias.
              linkReviewPending: res.review,
              metadata: {
                ...(res.nameKey ? { externalNameKey: res.nameKey, externalSource: FILE_SOURCE } : {}),
                ...(res.review ? { linkSuggestions: res.suggestions, linkReason: res.suggestions.length > 0 ? 'NAME_MATCH' : 'SAME_NAME_IN_FILE' } : {}),
              },
            });
          }
          const creditId = randomUUID();
          creditsData.push(
            creditCreateData(accountId, clientId, b, scope, stamp, { ...rowCtx, id: creditId, assignedManagerId: assignPlan.create.get(row.code)!.userId }),
          );
          snapshots.push(snapshotData(accountId, creditId, row.code, stamp.runId, reportAsOf, b));
          transitions.push({ creditId, action: 'EXTERNAL_APPEARED', externalId: row.code, after: reported(b) });
          item(ImportRunItemAction.CREATED, {
            creditId,
            clientId,
            externalId: row.code,
            clientName: clientLabel(b),
            rowNumber: row.index + 1,
            after: json({
              ...valuesOf(b, statusMap),
              assigneeId: assignPlan.create.get(row.code)!.userId,
              newClient: res.kind === 'new',
              ...(res.kind === 'new' && res.review ? { linkReview: true } : {}),
            }),
          });
          touched.push({ clientId, b });
        }
        if (clientsData.length > 0) await tx.client.createMany({ data: clientsData });
        await tx.credit.createMany({ data: creditsData });

        // La permanente de cada nuevo, por el servicio (la columna ya nació con el mismo valor).
        // Agrupadas por motivo: es lo único que cambia en la auditoría.
        const idOf = new Map(creditsData.map((c) => [c.externalId as string, c.id as string]));
        const byReason = new Map<AssignmentReason, AssignmentRequest[]>();
        for (const [code, a] of assignPlan.create) {
          const creditId = idOf.get(code);
          if (creditId) byReason.set(a.reason, [...(byReason.get(a.reason) ?? []), { creditId, to: a.userId }]);
        }
        for (const [reason, reqs] of byReason) assignmentChanges.push(...(await this.assignment.apply(tx, reqs, reason)));
      }

      for (const u of plan.toUpdate) {
        const b = u.row.data as unknown as NormalizedRecord;
        const prev = byId.get(u.id)!;
        await tx.credit.update({
          where: { id: u.id },
          data: creditUpdateData(b, (prev.metadata ?? {}) as Record<string, unknown>, stamp, { ...rowCtx, prevStatus: prev.status, prevWrittenOffAt: prev.writtenOffAt }),
        });
        snapshots.push(snapshotData(accountId, u.id, u.row.code, stamp.runId, reportAsOf, b));
        if (u.reappeared) transitions.push({ creditId: u.id, action: 'EXTERNAL_REAPPEARED', externalId: u.row.code, after: reported(b) });
        item(u.reappeared ? ImportRunItemAction.REAPPEARED : ImportRunItemAction.UPDATED, {
          creditId: u.id,
          clientId: prev.clientId,
          externalId: u.row.code,
          clientName: clientLabel(b),
          rowNumber: u.row.index + 1,
          before: json(valuesBefore(prev)),
          after: json({ ...valuesOf(b, statusMap), ...(reassignOf.has(u.row.code) ? { assignee: reassignOf.get(u.row.code) } : {}) }),
        });
        touched.push({ clientId: prev.clientId, b });
      }

      /*
       * Reasignaciones EXPLÍCITAS de existentes (las pidió quien reparte; nunca las decide el
       * archivo). `expectedFrom` = el responsable que se vio en la vista previa: si alguien lo cambió
       * mientras tanto, la corrida entera se cae con ASSIGNMENT_CONFLICT y no queda nada a medias.
       * Los casos abiertos no se tocan: su cobrador es otra responsabilidad (decisión 7).
       */
      if (assignPlan.reassign.length > 0) {
        const updatedId = new Map(plan.toUpdate.map((u) => [u.row.code, u.id] as const));
        assignmentChanges.push(
          ...(await this.assignment.apply(
            tx,
            assignPlan.reassign.map((r) => ({ creditId: updatedId.get(r.code)!, to: r.to, expectedFrom: r.from })),
            'IMPORT_REASSIGN',
          )),
        );
      }

      // Contacto y dirección van al final y por una vía aparte: no son campos del crédito, y su
      // regla es rellenar huecos, no pisar (ver `fillContactGaps`).
      await fillContactGaps(tx, accountId, touched);

      if (plan.toSetCurrent.length > 0) {
        // Con la regla 'set-current', la mora del ausente activo queda en 0: no está en el reporte de
        // mora. Saldo y ESTADO intactos: la ausencia no es un pago ni un cierre (D4). El `status`
        // del where es la segunda llave: el plan ya excluye los cerrados.
        await tx.credit.updateMany({
          where: { id: { in: plan.toSetCurrent }, status: CreditStatus.ACTIVE },
          data: { daysPastDue: 0 },
        });
        for (const id of plan.toSetCurrent) {
          const prev = byId.get(id)!;
          item(ImportRunItemAction.SET_CURRENT, {
            creditId: id,
            clientId: prev.clientId,
            externalId: prev.externalId ?? prev.code,
            clientName: nameOf(prev.client),
            before: json({ daysPastDue: prev.daysPastDue }),
            after: json({ daysPastDue: 0 }),
          });
        }
      }
      if (plan.toMarkAbsent.length > 0) {
        // La ausencia se registra en la transición (D4): `absent_since` es la fecha de corte del primer
        // reporte que no la trajo; sin fecha de corte, el día de la corrida.
        await tx.credit.updateMany({
          where: { id: { in: plan.toMarkAbsent } },
          data: { syncStatus: ExternalSyncStatus.ABSENT, absentSince: reportAsOf ?? new Date(stamp.at.slice(0, 10)) },
        });
        for (const id of plan.toMarkAbsent) {
          const prev = byId.get(id)!;
          const externalId = prev.externalId ?? prev.code ?? id;
          snapshots.push(snapshotData(accountId, id, externalId, stamp.runId, reportAsOf, null));
          transitions.push({
            creditId: id,
            action: 'EXTERNAL_ABSENT',
            externalId,
            // Lo último que se sabía: con esto se contesta «qué saldo y mora tenía antes de faltar».
            before: { outstandingBalance: Number(prev.outstandingBalance), daysPastDue: prev.daysPastDue, status: prev.status },
          });
          item(ImportRunItemAction.ABSENT, {
            creditId: id,
            clientId: prev.clientId,
            externalId,
            clientName: nameOf(prev.client),
            before: json(valuesBefore(prev)),
          });
        }
      }
      if (snapshots.length > 0) await tx.creditExternalSnapshot.createMany({ data: snapshots });
      // Las filas que no se pudieron importar también quedan: sin esto sólo se sabía cuántas.
      for (const inv of plan.invalid) {
        const b = blocks[inv.index];
        item(ImportRunItemAction.REJECTED, {
          externalId: b?.code ?? undefined,
          clientName: b ? clientLabel(b) : undefined,
          rowNumber: inv.index + 1,
          reason: inv.reason,
        });
      }

      const run = await tx.clientImportRun.create({
        data: {
          id: stamp.runId,
          accountId,
          source: 'portfolio',
          fileHash,
          mode: 'RECONCILE',
          status: 'DONE',
          template: config.profile.kind,
          // Sin `ref` (alcance de empresa) se guarda la clase a secas (FIELD-RULES §8 · item 14).
          scope: scopeText,
          externalSource: FILE_SOURCE,
          reportAsOf,
          advisorCode,
          creditsCreated: counts.created,
          creditsUpdated: counts.updated,
          creditsSetCurrent: counts.setCurrent,
          creditsAbsent: counts.absent,
          creditsReappeared: counts.reappeared,
          rowsIgnored: counts.ignored,
          needsReview: counts.needsReview,
          errors: counts.invalid,
          createdBy: this.tenant.userId,
          ...(stored
            ? { fileName: opts.fileName ?? null, fileSize: stored.size, fileMime: stored.mimeType, fileKey: stored.key }
            : {}),
          itemsComplete: true,
        },
      });
      if (items.length > 0) await tx.clientImportRunItem.createMany({ data: items });
      return {
        idempotentSkip: false,
        runId: run.id,
        scope,
        counts,
        preview,
        report,
        plan: planInfo,
        assignment,
        assigned: tally([...assignPlan.create.values()].map((a) => a.userId)),
        reassigned: assignPlan.reassign.length,
        ...(assignPlan.notes.length > 0 ? { assignmentNotes: assignPlan.notes } : {}),
        transitions,
        assignmentChanges,
      };
    });

    if (!dryRun && !result.idempotentSkip) {
      await this.audit.record({
        entity: 'portfolio_import',
        entityId: result.runId ?? fileHash,
        action: 'IMPORT',
        after: { template: config.profile.kind, scope: scopeLabel(result.scope), reportDate, advisorCode, ...result.counts },
      });
      // Un evento por operación que apareció, faltó o volvió (§13). Lo que cambió día a día sin
      // transición está en los snapshots, no en la auditoría: sería una fila por crédito por día.
      await this.audit.recordMany(
        result.transitions.map((t) => ({
          entity: 'credit',
          entityId: t.creditId,
          action: t.action,
          before: t.before,
          after: { runId: result.runId, reportDate, externalId: t.externalId, ...(t.after ?? {}) },
        })),
      );
      // Quién quedó responsable de qué: un ASSIGN por nuevo, un REASSIGN por reasignación explícita.
      await this.assignment.auditChanges(result.assignmentChanges, { runId: result.runId });
    }
    const { transitions: _omit, assignmentChanges: _changes, ...summary } = result;
    void _omit;
    void _changes;
    return { dryRun, ...summary };
  }

  // ── Historial de importaciones ─────────────────────────────────────────────

  /**
   * Las corridas de cartera, la más reciente primero, con búsqueda y filtros.
   *
   * 🔴 **Quién importó se busca por nombre, pero se guarda por id.** `created_by` es un uuid sin
   * relación en el schema, así que el texto se resuelve primero a los usuarios que coinciden y
   * después entra al `OR` como `createdBy in (...)`. Sin esto, buscar «Mónica» no encontraba nada
   * aunque la columna dijera «Mónica Manager».
   */
  async listRuns(query: ListImportRunsQueryDto): Promise<ApiResponse<ImportRunSummary[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.ClientImportRunWhereInput = { accountId: this.tenant.accountId, source: 'portfolio' };

    if (query.createdBy) where.createdBy = query.createdBy;
    if (query.from || query.to) {
      const tz = await this.clock.timezone();
      where.createdAt = {
        ...(query.from ? { gte: civilDayStartInstant(query.from, tz) } : {}),
        // Hasta el final del día pedido: el comienzo del siguiente, excluido.
        ...(query.to ? { lt: civilDayStartInstant(nextDay(query.to), tz) } : {}),
      };
    }
    if (query.reportFrom || query.reportTo) {
      where.reportAsOf = {
        ...(query.reportFrom ? { gte: new Date(query.reportFrom) } : {}),
        ...(query.reportTo ? { lte: new Date(query.reportTo) } : {}),
      };
    }
    if (query.q) {
      const q = query.q;
      const importers = await this.tx((tx) =>
        tx.user.findMany({
          where: {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { profile: { firstName: { contains: q, mode: 'insensitive' } } },
              { profile: { lastName: { contains: q, mode: 'insensitive' } } },
            ],
          },
          select: { id: true },
        }),
      );
      where.OR = [
        { fileName: { contains: q, mode: 'insensitive' } },
        { advisorCode: { contains: q, mode: 'insensitive' } },
        ...(importers.length ? [{ createdBy: { in: importers.map((u) => u.id) } }] : []),
      ];
    }

    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.clientImportRun.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        tx.clientImportRun.count({ where }),
      ]),
    );
    const names = await this.userNames(rows.map((r) => r.createdBy));
    return ResponseDto.paginated(
      rows.map((r) => runSummary(r, names)),
      total,
      page,
      limit,
    );
  }

  async getRun(id: string): Promise<ImportRunSummary> {
    const run = await this.findRun(id);
    return runSummary(run, await this.userNames([run.createdBy]));
  }

  /** Los movimientos de una corrida, filtrables por lo que les pasó. */
  async listRunItems(
    id: string,
    query: { page?: number; limit?: number; action?: ImportRunItemAction },
  ): Promise<ApiResponse<ImportRunItem[]>> {
    await this.findRun(id);
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.ClientImportRunItemWhereInput = {
      accountId: this.tenant.accountId,
      runId: id,
      ...(query.action ? { action: query.action } : {}),
    };
    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        // En el orden del archivo; las que no vinieron (ausentes, al día) al final, por operación.
        tx.clientImportRunItem.findMany({
          where,
          orderBy: [{ rowNumber: { sort: 'asc', nulls: 'last' } }, { externalId: 'asc' }, { id: 'asc' }],
          skip,
          take: limit,
        }),
        tx.clientImportRunItem.count({ where }),
      ]),
    );
    return ResponseDto.paginated(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        creditId: r.creditId ?? undefined,
        clientId: r.clientId ?? undefined,
        externalId: r.externalId ?? undefined,
        clientName: r.clientName ?? undefined,
        rowNumber: r.rowNumber ?? undefined,
        reason: r.reason ?? undefined,
        before: (r.before as ImportItemValues | null) ?? undefined,
        after: (r.after as ImportItemValues | null) ?? undefined,
      })),
      total,
      page,
      limit,
    );
  }

  /** El documento de la corrida, para verlo o descargarlo. */
  async runFile(id: string): Promise<{ stream: Readable; name: string; mimeType: string }> {
    const run = await this.findRun(id);
    if (!run.fileKey) throw new NotFoundException({ code: 'IMPORT_FILE_NOT_STORED', message: 'Esta importación es anterior a que se guardara el archivo' });
    return {
      stream: this.uploads.documentStream(run.fileKey),
      name: run.fileName ?? run.fileKey.split('/').pop()!,
      mimeType: run.fileMime ?? 'application/octet-stream',
    };
  }

  private async findRun(id: string) {
    const run = await this.tx((tx) =>
      tx.clientImportRun.findFirst({ where: { id, accountId: this.tenant.accountId, source: 'portfolio' } }),
    );
    if (!run) throw new NotFoundException({ code: 'IMPORT_RUN_NOT_FOUND', message: 'Importación no encontrada' });
    return run;
  }

  /** Nombre de quien importó. `users` es global: se lee por id, sin depender del tenant. */
  /**
   * El error de `resolveImportOwnership`, como respuesta HTTP. El de cartera ajena dice DE QUIÉN es:
   * «es del asesor CQE» no le alcanza a quien la subió para saber a quién pasársela.
   */
  private async ownershipError(tx: PrismaClient, e: unknown): Promise<unknown> {
    if (!(e instanceof ImportAssignmentError)) return e;
    if (e.code === 'ADVISOR_BELONGS_TO_OTHER') {
      const owner = String(e.details?.userId ?? '');
      const name = (await this.namesIn(tx, [owner])).get(owner) ?? 'otra persona';
      return new ForbiddenException({
        code: e.code,
        message: `Este reporte es la cartera de ${name} (asesor ${String(e.details?.advisorCode)}). Sólo podés importar tu propia cartera.`,
        details: e.details,
      });
    }
    return new BadRequestException({ code: e.code, message: e.message, details: e.details });
  }

  /** Nombres de usuario dentro de una transacción en curso (`userNames` abre la suya). */
  private async namesIn(tx: PrismaClient, ids: string[]): Promise<Map<string, string>> {
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, profile: true } });
    return new Map(users.map((u) => [u.id, u.profile ? `${u.profile.firstName} ${u.profile.lastName}`.trim() : u.email]));
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (unique.length === 0) return new Map();
    const users = await this.tx((tx) =>
      tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, email: true, profile: true } }),
    );
    return new Map(
      users.map((u) => [u.id, u.profile ? `${u.profile.firstName} ${u.profile.lastName}`.trim() : u.email]),
    );
  }

  // ── Asesores del reporte → usuarios (D8) ───────────────────────────────────

  /** Los vínculos vigentes, más los códigos que ya trajeron los reportes y todavía no tienen usuario. */
  async listAdvisorLinks(): Promise<{ links: { advisorCode: string; userId: string }[]; unlinked: string[] }> {
    const accountId = this.tenant.accountId;
    const [links, seen] = await this.tx((tx) =>
      Promise.all([
        tx.externalAdvisorLink.findMany({
          where: { accountId, externalSource: FILE_SOURCE, deletedAt: null },
          select: { advisorCode: true, userId: true },
          orderBy: { advisorCode: 'asc' },
        }),
        tx.clientImportRun.findMany({
          where: { accountId, externalSource: FILE_SOURCE, advisorCode: { not: null } },
          select: { advisorCode: true },
          distinct: ['advisorCode'],
        }),
      ]),
    );
    const linked = new Set(links.map((l) => l.advisorCode));
    const unlinked = seen.map((r) => r.advisorCode!).filter((c) => !linked.has(c)).sort();
    return { links, unlinked };
  }

  async linkAdvisor(rawCode: string, userId: string): Promise<{ advisorCode: string; userId: string }> {
    await this.assertCanConfigure();
    const advisorCode = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(advisorCode)) {
      throw new BadRequestException({ code: 'INVALID_ADVISOR_CODE', message: 'El código de asesor no es válido' });
    }
    const accountId = this.tenant.accountId;
    const saved = await this.tx(async (tx) => {
      const member = await tx.userAccount.findFirst({ where: { userId, isActive: true } });
      if (!member) throw new BadRequestException({ code: 'USER_NOT_MEMBER', message: 'Ese usuario no es parte de la empresa' });
      return tx.externalAdvisorLink.upsert({
        where: { accountId_externalSource_advisorCode: { accountId, externalSource: FILE_SOURCE, advisorCode } },
        create: { accountId, externalSource: FILE_SOURCE, advisorCode, userId },
        update: { userId, deletedAt: null },
        select: { advisorCode: true, userId: true },
      });
    });
    await this.audit.record({ entity: 'external_advisor_link', entityId: advisorCode, action: 'UPSERT', after: saved });
    return saved;
  }

  async unlinkAdvisor(rawCode: string): Promise<{ advisorCode: string }> {
    await this.assertCanConfigure();
    const advisorCode = rawCode.trim().toUpperCase();
    const accountId = this.tenant.accountId;
    await this.tx((tx) =>
      tx.externalAdvisorLink.updateMany({
        where: { accountId, externalSource: FILE_SOURCE, advisorCode, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
    await this.audit.record({ entity: 'external_advisor_link', entityId: advisorCode, action: 'DELETE' });
    return { advisorCode };
  }

  // ── Configuración (N3) ─────────────────────────────────────────────────────

  /** Todo lo que la pantalla de Ajustes necesita para dibujarse, en una sola llamada (§6). */
  async getConfigScreen(): Promise<{
    config: ImportConfig;
    catalog: typeof FIELD_CATALOG;
    lastRun: LastRun | null;
    members: ScopeMember[];
    branches: ScopeBranch[];
    viewer: ImportViewer;
  }> {
    const accountId = this.tenant.accountId;
    const canConfigure = await this.canConfigure();
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
            reportDate: run.reportAsOf ? run.reportAsOf.toISOString().slice(0, 10) : null,
            advisorCode: run.advisorCode,
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
      viewer: { userId: this.tenant.userId ?? '', canAssign: this.tenant.can(Permission.ASSIGNMENT_WRITE), canConfigure },
    };
  }

  /**
   * P1 · Quién cambia la configuración y los vínculos de asesor: quien reparte la cartera
   * (`assignment:write`) o el dueño de la cuenta.
   *
   * 🔴 **No alcanza con `client:import`.** El vínculo asesor → usuario decide de quién es cada
   * cartera: con sólo importar, un cobrador podía vincularse el código de otro asesor y después
   * importar —y quedarse— esa cartera, salteando la regla de «sólo tu propia cartera». El dueño
   * entra igual porque el cobrador independiente es COLLECTOR y dueño a la vez, y configura lo suyo.
   */
  private async canConfigure(): Promise<boolean> {
    if (this.tenant.can(Permission.ASSIGNMENT_WRITE)) return true;
    const userId = this.tenant.userId;
    if (!userId) return false;
    const owner = await this.tx((tx) =>
      tx.userAccount.findFirst({
        where: { accountId: this.tenant.accountId, userId, isActive: true, isOwner: true },
        select: { id: true },
      }),
    );
    return owner !== null;
  }

  private async assertCanConfigure(): Promise<void> {
    if (!(await this.canConfigure())) {
      throw new ForbiddenException({
        code: 'IMPORT_CONFIG_FORBIDDEN',
        message: 'Sólo quien reparte la cartera o el dueño de la cuenta cambia la configuración de importación',
      });
    }
  }

  /**
   * Guarda un cambio de configuración. Valida los invariantes de §3.1 **acá**, no sólo en la UI:
   * la config vive en un JSONB sin esquema, y una regla contradictoria guardada se convierte en
   * una cartera mal importada. Merge superficial: la pantalla guarda campo por campo.
   */
  async patchConfig(patch: ImportConfigPatch): Promise<{ config: ImportConfig }> {
    await this.assertCanConfigure();
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
    samples: Record<string, string[]>;
    recordStartCandidates: { text: string; count: number }[];
    headerCandidates: { anchor: string; preview: string }[];
  }> {
    const config = await this.importConfig();
    assertFileShape(file, config.profile.kind);
    // Las tres formas devuelven la misma respuesta; lo que cambia es qué pregunta le falta
    // contestar al usuario, y cada forma trae sólo la suya. Una planilla no tiene ninguna: cada
    // fila ya es un registro y la primera son los encabezados.
    const empty = { recordStartCandidates: [], headerCandidates: [] };
    try {
      if (config.profile.kind === 'rows') {
        const { labels, columnCandidates, samples } = await parseRowsFile(file, config.profile, config.fieldMap);
        return { labels, columnCandidates, samples, ...empty };
      }
      if (config.profile.kind === 'pdf-rows') {
        const { labels, columnCandidates, samples, headerCandidates } = await parsePdfRows(
          new Uint8Array(file),
          config.profile,
          config.fieldMap,
        );
        return { labels, columnCandidates, samples, recordStartCandidates: [], headerCandidates };
      }
      const { labels, columnCandidates, samples, recordStartCandidates } = await parsePdfBlocks(
        new Uint8Array(file),
        config.profile,
        config.fieldMap,
      );
      return { labels, columnCandidates, samples, recordStartCandidates, headerCandidates: [] };
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
}

/** Cómo se muestra el cliente en la Vista Previa. */
/**
 * El motor que le toca a esta forma de archivo. Un solo lugar donde están las tres, para que
 * sumar una cuarta no obligue a acordarse de los dos sitios que las elegían.
 */
function readWithProfile(
  file: Buffer,
  profile: RunConfig['profile'],
  fieldMap: FieldMap,
): Promise<Record<string, string | null>[]> {
  if (profile.kind === 'rows') return parseRowsFile(file, profile, fieldMap).then((r) => r.records);
  if (profile.kind === 'pdf-rows') return parsePdfRows(new Uint8Array(file), profile, fieldMap).then((r) => r.records);
  return parsePdfBlocks(new Uint8Array(file), profile, fieldMap).then((r) => r.records);
}

/** Teléfono y dirección que el archivo trae para un cliente ya identificado. */
interface ContactGap {
  clientId: string;
  b: NormalizedRecord;
}

/**
 * Escribe teléfono y dirección del archivo, **sólo donde falten**.
 *
 * Es una regla distinta a la de los montos, y a propósito. Un saldo del archivo es más nuevo que
 * el de la DB, así que pisa. Una dirección NO: la que está cargada la puso el cobrador que fue
 * hasta la casa, y el reporte trae la que el sistema del banco tenía el día que abrieron el
 * crédito. Pisarla sería reemplazar lo que alguien vio por lo que alguien tipeó hace dos años.
 *
 * Por eso: si el cliente ya tiene teléfono, no se toca; si no tiene, se agrega. Ídem dirección.
 * Nunca borra ni reemplaza (§4). Y por eso rellena huecos en vez de acumular por valor distinto:
 * un reporte que cada día escribe la misma dirección de otra forma convertiría a un cliente en
 * veinte direcciones, que es peor que no tener ninguna.
 */
async function fillContactGaps(tx: PrismaClient, accountId: string, entries: ContactGap[]): Promise<void> {
  // Un cliente con DOS créditos en el mismo archivo llega dos veces: la llave del import es el
  // crédito, no el cliente. Sin este corte, ninguna de las dos filas encuentra un teléfono
  // existente y las dos lo crean → el cliente arranca con el mismo número cargado dos veces.
  // Gana la primera aparición; son el mismo dato.
  const byClient = new Map<string, ContactGap>();
  for (const e of entries) if (!byClient.has(e.clientId)) byClient.set(e.clientId, e);
  const unique = [...byClient.values()];

  const wantsPhone = unique.filter((e) => e.b.phone);
  const wantsAddress = unique.filter((e) => e.b.address ?? e.b.addressRef);
  // El negocio es otra ubicación (WORK), con su propio hueco: tener la casa no dice dónde está el puesto.
  const wantsBusiness = unique.filter((e) => e.b.businessAddress);
  if (wantsPhone.length === 0 && wantsAddress.length === 0 && wantsBusiness.length === 0) return;

  // Quién YA tiene. Los recién creados no aparecen (no tienen nada todavía), así que altas y
  // existentes pasan por el mismo camino en vez de por dos ramas que se desincronizan.
  const [withPhone, withAddress, withBusiness] = await Promise.all([
    wantsPhone.length > 0
      ? tx.clientContact.findMany({
          where: { accountId, clientId: { in: wantsPhone.map((e) => e.clientId) } },
          select: { clientId: true },
          distinct: ['clientId'],
        })
      : [],
    wantsAddress.length > 0
      ? tx.clientLocation.findMany({
          where: { accountId, clientId: { in: wantsAddress.map((e) => e.clientId) } },
          select: { clientId: true },
          distinct: ['clientId'],
        })
      : [],
    wantsBusiness.length > 0
      ? tx.clientLocation.findMany({
          where: { accountId, clientId: { in: wantsBusiness.map((e) => e.clientId) }, locationType: LocationType.WORK },
          select: { clientId: true },
          distinct: ['clientId'],
        })
      : [],
  ]);
  const hasPhone = new Set(withPhone.map((c) => c.clientId));
  const hasAddress = new Set(withAddress.map((c) => c.clientId));
  const hasBusiness = new Set(withBusiness.map((c) => c.clientId));

  const contacts = wantsPhone
    .filter((e) => !hasPhone.has(e.clientId))
    .flatMap((e) =>
      splitPhones(e.b.phone!).map((value, i) => ({
        accountId,
        clientId: e.clientId,
        contactType: ContactType.PHONE,
        value,
        isPrimary: i === 0,
      })),
    );
  const locations: Prisma.ClientLocationCreateManyInput[] = [
    ...wantsAddress
      .filter((e) => !hasAddress.has(e.clientId))
      .map((e) => ({
        accountId,
        clientId: e.clientId,
        locationType: LocationType.HOME,
        address: e.b.address ?? undefined,
        // La referencia es cómo se llega ("Frente a la cancha"): para el cobrador vale tanto como
        // la calle, y va en la misma ubicación, no en otra.
        referenceNotes: e.b.addressRef ?? undefined,
      })),
    ...wantsBusiness
      .filter((e) => !hasBusiness.has(e.clientId))
      .map((e) => ({ accountId, clientId: e.clientId, locationType: LocationType.WORK, address: e.b.businessAddress ?? undefined })),
  ];

  if (contacts.length > 0) await tx.clientContact.createMany({ data: contacts });
  if (locations.length > 0) await tx.clientLocation.createMany({ data: locations });
}

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
  const isPdfProfile = kind === 'pdf-blocks' || kind === 'pdf-rows';
  if (shape === 'pdf' && !isPdfProfile) {
    throw new BadRequestException({
      code: 'FILE_SHAPE_MISMATCH',
      message: 'Subiste un PDF, pero la configuración dice CSV. Cambiá "Forma del archivo" en Ajustes › Importación.',
    });
  }
  // Una planilla binaria (.xlsx, .ods) empaqueta en zip. Con perfil `rows` es válida y la abre
  // `parseRowsFile`; con perfil PDF es el archivo equivocado.
  if (shape === 'zip' && isPdfProfile) {
    throw new BadRequestException({
      code: 'FILE_SHAPE_MISMATCH',
      message: 'Subiste una planilla, pero la configuración dice PDF. Cambiá "Forma del archivo" en Ajustes › Importación.',
    });
  }
  // `.xls` de Excel 97-2003: el picker lo deja elegir y el motor sólo abre el formato moderno.
  // El arreglo está en manos del usuario y es de un minuto, así que el mensaje lo nombra.
  if (shape === 'ole2') {
    throw new BadRequestException({
      code: 'XLS_LEGACY_NOT_SUPPORTED',
      message: 'Ese archivo es de una versión vieja de Excel (.xls). Abrilo y guardalo como .xlsx o CSV, y volvé a subirlo.',
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

function emptyPreview(): PortfolioSummary['preview'] {
  return { toCreate: [], toUpdate: [], toSetCurrent: [], toMarkAbsent: [], invalid: [], warnings: [] };
}
/** `YYYY-MM-DD` de un ISO (o de algo que empiece como uno); `null` si no es una fecha real. */
function isoDay(raw: string): string | null {
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? null : day;
}

/** 28/09/2026: como lo escribe el reporte, para que el mensaje se lea igual que el archivo. */
function fmtDay(d: Date): string {
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/** Lo reportado que vale la pena en el evento de auditoría de una operación. */
/** La corrida como la ve el historial. «Actualizadas» no incluye las reaparecidas: van aparte. */
export function runSummary(
  r: {
    id: string;
    createdAt: Date;
    createdBy: string | null;
    template: string | null;
    scope: string | null;
    externalSource: string | null;
    reportAsOf: Date | null;
    advisorCode: string | null;
    creditsCreated: number;
    creditsUpdated: number;
    creditsReappeared: number;
    creditsSetCurrent: number;
    creditsAbsent: number;
    errors: number;
    rowsIgnored: number;
    needsReview: number;
    fileName: string | null;
    fileSize: number | null;
    fileMime: string | null;
    fileKey: string | null;
    itemsComplete: boolean;
  },
  names: Map<string, string>,
): ImportRunSummary {
  const who = r.createdBy ? names.get(r.createdBy) : undefined;
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    ...(r.createdBy && who ? { createdBy: { id: r.createdBy, name: who } } : {}),
    template: r.template,
    scope: r.scope,
    externalSource: r.externalSource,
    reportDate: r.reportAsOf ? r.reportAsOf.toISOString().slice(0, 10) : null,
    advisorCode: r.advisorCode,
    counts: {
      created: r.creditsCreated,
      updated: Math.max(0, r.creditsUpdated - r.creditsReappeared),
      reappeared: r.creditsReappeared,
      setCurrent: r.creditsSetCurrent,
      absent: r.creditsAbsent,
      rejected: r.errors,
      ignored: r.rowsIgnored,
      needsReview: r.needsReview,
    },
    ...(r.fileKey ? { file: { name: r.fileName ?? 'documento', size: r.fileSize ?? 0, mimeType: r.fileMime ?? 'application/octet-stream' } } : {}),
    itemsComplete: r.itemsComplete,
  };
}

/** Lo que el reporte dice de la operación, con el estado ya traducido al del crédito. */
function valuesOf(b: NormalizedRecord, statusMap?: Record<string, CreditStatus>): ImportItemValues {
  return {
    outstandingBalance: b.outstandingBalance ?? null,
    daysPastDue: b.daysPastDue ?? null,
    status: storedStatus(b.status ?? null, statusMap) ?? CreditStatus.ACTIVE,
    reportedStatus: b.status ?? null,
  };
}

/** Cómo estaba la operación antes de la corrida. */
function valuesBefore(c: { outstandingBalance: unknown; daysPastDue: number; status: string }): ImportItemValues {
  return { outstandingBalance: Number(c.outstandingBalance), daysPastDue: c.daysPastDue, status: c.status };
}

function nameOf(c: { firstName: string | null; lastName: string | null; businessName: string | null } | null): string | undefined {
  if (!c) return undefined;
  return c.businessName ?? ([c.lastName, c.firstName].filter(Boolean).join(' ') || undefined);
}

/** Prisma rechaza `undefined` dentro de un JSON. */
function json(o: object): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Prisma.InputJsonObject;
}

function reported(b: NormalizedRecord): Record<string, unknown> {
  return { outstandingBalance: b.outstandingBalance, daysPastDue: b.daysPastDue, status: b.status };
}

function emptyCounts(): Counts {
  return { created: 0, updated: 0, setCurrent: 0, invalid: 0, absent: 0, reappeared: 0, needsReview: 0, ignored: 0 };
}

