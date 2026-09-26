import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, CasePriority, CaseStatus, CreditStatus, InstallmentStatus } from '@prisma/client';
import {
  addPeriods,
  arrearsByMethod,
  arrearsFromDueDate,
  arrearsMethodOf,
  ArrearsMethod,
  DEFAULT_ARREARS_METHOD,
  oldestUnpaid,
  withArrearsMethod,
  CREDIT_TERMS_VERSION,
  creditTotalToCollect,
  CreditOrigin,
  parseCreditTerms,
  resolveCreditTerms,
  registeredState,
  hasInitialState,
  type CreditScheduleRow,
  type CreditTerms,
  type TermsResolution,
  type TermsResolutionError,
  isExternalOrigin,
  manualArrears,
  moraSinceFromDays,
  PaymentFrequency,
  readCreditMetadata,
  resolvePagination,
  type ApiResponse,
  type BalanceBasis,
  type CreditMetadata,
  ResponseDto,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { PlanLimitsService } from '../../common/plan/plan-limits.service';
import {
  buildSchedule,
  computeArrears,
  scheduleIsBalanced,
  DEFAULT_ARREAR_PARAMS,
  type ArrearParams,
} from './credit-math';
import { serializeCredit } from './credits.serializer';
import { ClearArrearsDto, CreateCreditDto, ListCreditsQueryDto, UpdateCreditDto } from './dto/credit.dto';
import {
  arrearsDateNotFuture,
  creditHasPayments,
  creditHasSchedule,
  creditInitialStateInvalid,
  creditInstallmentMismatch,
  creditLocked,
  creditNotActive,
  creditTermsConflict,
  creditTermsEditUnsupported,
  creditTermsInvalid,
  currencyMismatch,
  resourceNotFound,
  scheduleInvalid,
} from './credits.errors';
import { computePriority, slaDueAt, DEFAULT_PRIORITY_PARAMS } from '../cases/case-priority';
import { closeOpenCases, openCaseIfNone } from '../arrears/case-lifecycle';

interface AccountConfig {
  currencyCode: string;
  labels: Record<string, string>;
  arrears: ArrearParams;
  /** Método de mora por defecto de los créditos nuevos (D20), de `accounts.settings`. */
  arrearsMethod: ArrearsMethod;
}

@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly plan: PlanLimitsService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Config del tenant (moneda, etiquetas de concepto, parámetros de mora). `accounts` tiene RLS → leer con contexto. */
  private async accountConfig(): Promise<AccountConfig> {
    const account = await this.tx((tx) => tx.account.findUnique({ where: { id: this.tenant.accountId } }));
    const cfg = (account?.configuration ?? {}) as {
      creditLabels?: Record<string, string>;
      arrears?: Partial<ArrearParams>;
    };
    return {
      currencyCode: account?.currencyCode ?? 'USD',
      labels: cfg.creditLabels ?? {},
      arrears: { ...DEFAULT_ARREAR_PARAMS, ...(cfg.arrears ?? {}) },
      arrearsMethod: arrearsMethodOf(account?.settings),
    };
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
  async create(dto: CreateCreditDto): Promise<ReturnType<typeof serializeCredit>> {
    const config = await this.accountConfig();
    const currency = dto.currency ?? config.currencyCode;
    if (dto.currency && dto.currency !== config.currencyCode) throw currencyMismatch(config.currencyCode);

    /*
     * F4/06 · D14: con condiciones (`terms`) la API recalcula con el motor único y **manda según el
     * modo**; cuota, número de cuotas, frecuencia, primera fecha y tasa salen de ahí, no de los campos
     * sueltos (que, si vienen, tienen que coincidir). Sin `terms`, el alta de siempre.
     */
    const resolved = dto.terms !== undefined ? resolveTerms(dto) : undefined;

    /*
     * «Ya está en curso» con condiciones (D13): la misma regla que la edición (`registeredState`),
     * aplicada en el alta para que el móvil lo cargue en una sola operación offline.
     */
    if (dto.initialState && !resolved) throw creditTermsInvalid(['TERMS_REQUIRED']);
    if (dto.initialState && dto.outstandingBalance !== undefined) throw creditTermsConflict('outstandingBalance');
    if (dto.initialState && dto.daysPastDue !== undefined) throw creditTermsConflict('daysPastDue');
    const registered = resolved && dto.initialState ? registeredState(resolved.terms, dto.initialState) : undefined;
    if (registered && !registered.ok) throw creditInitialStateInvalid(registered.code);
    const asOf = new Date();
    /*
     * Cuota variable (capital fijo): no hay UNA cuota que congelar. Se guarda el cronograma del motor
     * fila por fila y de ahí salen los pagos, la mora y la próxima fecha, como en los créditos con
     * cronograma de siempre. Las cuotas ya pagadas al registrarlo (D13) nacen pagadas.
     */
    const variableSchedule = resolved?.schedule ?? null;
    const installmentAmount = resolved ? (variableSchedule ? undefined : resolved.installmentAmount) : dto.installmentAmount;
    const installmentsCount = resolved ? resolved.installmentsCount : dto.installmentsCount;
    const interestRate = resolved ? resolved.interestRatePercent : (dto.interestRate ?? 0);

    const disbursedAt = dto.disbursedAt ? new Date(dto.disbursedAt) : new Date();
    const firstDueDate = resolved
      ? new Date(`${resolved.nextDueDate}T00:00:00.000Z`)
      : dto.firstDueDate
        ? new Date(dto.firstDueDate)
        : addMonths(disbursedAt, 1);

    /**
     * Dos formas de nacer, y las distingue un solo dato (spec §4, §7, §8):
     *  · con `installmentAmount` → crédito de cobranza: la cuota viene **congelada** del móvil y
     *    NO se genera cronograma. Es el único modo que admite el préstamo abierto (sin `n`).
     *    Con `terms` siempre es este camino: el cronograma real llega en F4/06 · Fase 6.
     *  · sin él → comportamiento de siempre (web/importador): cronograma amortizado.
     */
    const frozenInstallment = installmentAmount !== undefined;
    const schedule: InstallmentRow[] = variableSchedule
      ? installmentRows(variableSchedule, dto.initialState?.paidInstallments ?? 0)
      : frozenInstallment
        ? []
        : buildSchedule({
            principal: dto.principalAmount,
            periodicRate: dto.interestRate ?? 0,
            count: dto.installmentsCount ?? 1,
            type: dto.amortizationType ?? 'FRENCH',
            firstDueDate,
          });
    // El cronograma del motor puede llevar seguro y cargos dentro de la cuota (D18), que la tabla no
    // separa: ahí el invariante es Σ capital = monto (cada cuota ya es la suma de sus partes).
    const balanced = variableSchedule
      ? Math.round(schedule.reduce((s, r) => s + r.principal * 100, 0)) === Math.round(dto.principalAmount * 100)
      : scheduleIsBalanced(dto.principalAmount, schedule);
    if (!frozenInstallment && !balanced) throw scheduleInvalid();

    /*
     * 🔴 D15 (F4/06): el saldo es el **total pendiente de cobro**, no el capital. Antes nacía igual al
     * capital y el pago que lo superaba se rechazaba: en 1.000 al 10 % en 5 cuotas de 300, la 4.ª cuota
     * rebotaba con «El monto excede el saldo» y la ganancia no se podía cobrar nunca.
     *
     *  · "ya está en curso" → el saldo que dijo quien lo carga (es lo que falta cobrar);
     *  · total conocido (cronograma, o cuota × n) → ese total;
     *  · préstamo abierto → nadie sabe el total: saldo = capital, marcado `principal` (D16).
     */
    const totalToCollect = resolved
      ? resolved.totalToCollect
      : creditTotalToCollect({
          principalAmount: dto.principalAmount,
          installmentAmount,
          installmentsCount,
          installments: schedule,
        });
    const balanceBasis: BalanceBasis = registered?.ok
      ? registered.balanceBasis
      : dto.outstandingBalance !== undefined || totalToCollect !== null
        ? 'total'
        : 'principal';
    const outstandingBalance = registered?.ok
      ? registered.outstandingBalance
      : (dto.outstandingBalance ?? totalToCollect ?? dto.principalAmount);
    // D20: el método del crédito; si el alta no lo dice, el default de la cuenta. Se guarda siempre, así
    // cambiar el default de la cuenta después no cambia cómo se cuenta la mora de los créditos ya dados.
    const arrearsMethod = dto.arrearsMethod ?? config.arrearsMethod;
    // Mora declarada al registrarlo (apps viejas) → marca manual, como en la edición. Si no se declaró, la
    // calcula la fecha de la primera cuota impaga (k+1) con el método del crédito.
    const moraSince = registered?.ok && registered.daysPastDue > 0 ? moraSinceFromDays(registered.daysPastDue, asOf) : undefined;
    const initialArrears =
      registered?.ok && !moraSince
        ? arrearsByMethod({ method: arrearsMethod, oldestUnpaidDue: registered.nextDueDate, balance: registered.outstandingBalance, asOf })
        : undefined;
    const daysPastDue = registered?.ok
      ? moraSince
        ? registered.daysPastDue
        : initialArrears!.daysPastDue
      : (dto.daysPastDue ?? 0);

    const metadata: CreditMetadata = {
      frequency: resolved?.frequency ?? dto.frequency ?? PaymentFrequency.MONTHLY,
      origin: dto.origin ?? CreditOrigin.MANUAL,
      installmentAmount,
      nextDueDate:
        (registered?.ok ? registered.nextDueDate : undefined) ??
        resolved?.nextDueDate ??
        dto.nextDueDate?.slice(0, 10) ??
        (frozenInstallment ? isoDate(firstDueDate) : undefined),
      externalRef: dto.externalRef,
      notes: dto.notes,
      balanceBasis,
      // Las condiciones tal como las validó el motor: el detalle regenera el MISMO plan con ellas.
      ...(resolved ? { terms: resolved.terms, termsVersion: CREDIT_TERMS_VERSION } : {}),
      initialState: hasInitialState(dto.initialState) ? { ...dto.initialState } : undefined,
      moraSince,
      arrearsMethod,
      arrearsSince: initialArrears?.arrearsSince,
    };

    const accountId = this.tenant.accountId;
    const created = await this.tx(async (tx) => {
      // Alta idempotente (igual que en clientes): si el móvil propuso un id y ese préstamo ya
      // existe, esta llamada es el reintento de una alta encolada sin señal. Devolverlo evita
      // darle dos préstamos al mismo deudor por un problema de cobertura.
      if (dto.id) {
        const previo = await tx.credit.findFirst({ where: { id: dto.id, deletedAt: null } });
        // Sin `caseId`/`agendaId`: el caso y el recordatorio se crearon en el intento que sí entró,
        // y lo único que hacen acá abajo es auditarse. Un reintento no vuelve a auditar nada.
        if (previo) return { credit: previo, caseId: undefined, agendaId: undefined, reintento: true };
      }

      const client = await tx.client.findFirst({
        where: { id: dto.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) throw resourceNotFound(); // cliente inexistente o de otro tenant

      // 🔴 El tope de créditos del plan. Va DESPUÉS de la guarda de idempotencia: un reintento de
      // algo que ya entró no vuelve a pedir lugar.
      //
      // `soft` cuando el id lo puso el teléfono: ese préstamo **ya se acordó en la calle**, con el
      // cobrador parado frente al deudor, y llega horas después al reconectar. Rechazarlo acá es
      // borrar trabajo hecho y el cobrador se entera por un renglón rojo en la hoja de pendientes.
      // El aviso va donde la persona todavía puede hacer algo: en el teléfono, antes de encolar.
      await this.plan.assertRoom('credits', tx, { soft: Boolean(dto.id) });

      const credit = await tx.credit.create({
        data: {
          // Sólo si el móvil lo propuso: mandar `id: undefined` haría que el default del schema
          // no se aplique en algunos clientes, y deja la clave presente con valor vacío.
          ...(dto.id ? { id: dto.id } : {}),
          accountId,
          clientId: dto.clientId,
          branchId: dto.branchId,
          code: dto.code,
          typeCode: dto.typeCode,
          principalAmount: dto.principalAmount,
          outstandingBalance,
          interestRate, // con `terms`: el % del calculado, 0 si fue acordado (D7: sólo informativa)
          currency,
          installmentsCount: installmentsCount ?? 0, // 0 = préstamo abierto (§4.1)
          daysPastDue,
          assignedManagerId: dto.assignedManagerId,
          disbursedAt,
          metadata: stripUndefined(metadata),
          installments: {
            create: schedule.map((s) => ({ accountId, ...s })),
          },
        },
        include: { installments: { orderBy: { number: 'asc' } } },
      });

      // Caso de cobranza automático (§5.2): "para el cobrador, cliente y préstamo son una sola acción".
      if (dto.openCase) {
        const kase = await tx.collectionCase.create({
          data: {
            accountId,
            creditId: credit.id,
            clientId: dto.clientId,
            branchId: dto.branchId,
            assigneeId: this.tenant.userId,
            status: CaseStatus.PENDING,
            priority: priorityFromArrears(daysPastDue),
          },
        });
        // Próxima fecha de cobro en la agenda del cobrador (§5.2). Recordatorio de día (sin hora).
        // Solo por el alta del móvil (`openCase`); la web/import usa `cases/generate` → no genera agenda.
        let agendaId: string | undefined;
        if (metadata.nextDueDate && this.tenant.userId) {
          const item = await tx.agendaItem.create({
            data: {
              accountId,
              caseId: kase.id,
              clientId: dto.clientId,
              creditId: credit.id,
              assigneeId: this.tenant.userId,
              type: AgendaItemType.REMINDER,
              status: AgendaItemStatus.SCHEDULED,
              scheduledDate: new Date(metadata.nextDueDate),
              details: { description: 'Cobrar cuota' },
              createdBy: this.tenant.userId,
            },
          });
          agendaId = item.id;
        }
        return { credit, caseId: kase.id, agendaId, reintento: false };
      }
      return { credit, caseId: undefined, agendaId: undefined, reintento: false };
    });

    // El alta ya se auditó cuando entró de verdad: un reintento de la cola no la registra dos veces.
    if (created.reintento) return serializeCredit(created.credit, config.labels);

    await this.audit.record({ entity: 'credit', entityId: created.credit.id, action: 'CREATE', after: creditSummary(created.credit) });
    if (created.caseId) {
      await this.audit.record({ entity: 'collection_case', entityId: created.caseId, action: 'CREATE', after: { creditId: created.credit.id, clientId: dto.clientId, source: 'credit_create' } });
    }
    if (created.agendaId) {
      await this.audit.record({ entity: 'agenda_item', entityId: created.agendaId, action: 'CREATE', after: { creditId: created.credit.id, caseId: created.caseId, source: 'credit_create' } });
    }
    return serializeCredit(created.credit, config.labels);
  }

  async list(query: ListCreditsQueryDto): Promise<ApiResponse<ReturnType<typeof serializeCredit>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const config = await this.accountConfig();
    const where: Prisma.CreditWhereInput = { deletedAt: null };
    if (query.clientId) where.clientId = query.clientId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;

    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.credit.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        tx.credit.count({ where }),
      ]),
    );
    return ResponseDto.paginated(
      rows.map((c) => serializeCredit(c, config.labels)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<ReturnType<typeof serializeCredit>> {
    const config = await this.accountConfig();
    const credit = await this.tx((tx) =>
      tx.credit.findFirst({
        where: { id, deletedAt: null },
        include: { installments: { orderBy: { number: 'asc' } }, arrears: true, _count: { select: { payments: true } } },
      }),
    );
    if (!credit) throw resourceNotFound();
    return serializeCredit(credit, config.labels);
  }

  async getSchedule(id: string) {
    const credit = await this.findOne(id);
    return { creditId: credit.id, installments: credit.installments ?? [] };
  }

  /**
   * Editar el crédito. Tres clases de cambio, con reglas distintas:
   *
   *  · **Organización** (estado, código, tipo, responsable, sucursal): siempre, también en el importado.
   *  · **Operativos** (nota, próximo vencimiento): cualquier crédito propio, tenga o no condiciones.
   *  · **Financieros**, de dos formas que no se mezclan en un mismo pedido:
   *      - `terms` / `initialState` (F4/06 · Fase 3): se redefine el crédito con el motor. Cuota,
   *        total, saldo (D15), próximo vencimiento y mora salen de `resolveCreditTerms` +
   *        `registeredState` (D13), la misma regla que muestra la ficha. **Sólo sin pagos**: con pagos,
   *        cambiarlo reescribiría lo cobrado, y eso es una reestructura.
   *      - los campos sueltos (capital, tasa, cuota, frecuencia): la edición anterior, sólo para
   *        créditos sin `terms` — tocar uno suelto dejaría dos definiciones del mismo crédito.
   */
  async update(id: string, dto: UpdateCreditDto): Promise<ReturnType<typeof serializeCredit>> {
    const config = await this.accountConfig();
    const redefine = dto.terms !== undefined || dto.initialState !== undefined;
    const looseField = LOOSE_FINANCIAL_FIELDS.find((k) => dto[k] !== undefined);
    const operational = dto.nextDueDate !== undefined || dto.notes !== undefined;
    if (redefine && looseField) throw creditTermsConflict(looseField);
    // Al redefinir, el próximo vencimiento se deriva de las cuotas pagadas: no se manda aparte.
    if (redefine && dto.nextDueDate !== undefined) throw creditTermsConflict('nextDueDate');

    const asOf = new Date();
    const { before, after, caseOpened } = await this.tx(async (tx) => {
      const prev = await tx.credit.findFirst({
        where: { id, deletedAt: null },
        include: { _count: { select: { payments: true, installments: true } }, client: { select: { riskSegment: true } } },
      });
      if (!prev) throw resourceNotFound();
      const meta = readCreditMetadata(prev.metadata);
      if ((redefine || looseField || operational) && isExternalOrigin(meta.origin)) throw creditLocked();
      if (looseField && meta.terms) throw creditTermsEditUnsupported();

      /*
       * D20: cambiar cómo se cuenta la mora a mitad de vida la reescribiría de un clic (8 días pasan a
       * 38): con pagos registrados se bloquea, igual que las condiciones. El cambio queda en la auditoría
       * (`arrearsMethod` en el antes y el después).
       */
      const currentMethod = meta.arrearsMethod ?? DEFAULT_ARREARS_METHOD;
      const methodChange = dto.arrearsMethod !== undefined && dto.arrearsMethod !== currentMethod;
      if (methodChange && isExternalOrigin(meta.origin)) throw creditLocked();
      if (methodChange && prev._count.payments > 0) throw creditHasPayments();
      const method = methodChange ? dto.arrearsMethod! : currentMethod;

      // Cuota/frecuencia/próxima fecha/nota viven en metadata (D1); se hace merge preservando el resto.
      let nextMeta: CreditMetadata = {
        ...meta,
        ...(dto.installmentAmount !== undefined ? { installmentAmount: dto.installmentAmount } : {}),
        ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
        ...(dto.nextDueDate !== undefined ? { nextDueDate: dto.nextDueDate.slice(0, 10) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      };
      const data: Prisma.CreditUncheckedUpdateInput = {
        status: dto.status,
        assignedManagerId: dto.assignedManagerId,
        branchId: dto.branchId,
        code: dto.code,
        typeCode: dto.typeCode,
        principalAmount: dto.principalAmount,
        interestRate: dto.interestRate,
      };

      if (redefine) {
        if (prev._count.payments > 0) throw creditHasPayments();
        // Cronograma de la web anterior a F4/06: no hay condiciones de las que regenerarlo. El de una
        // cuota variable sí las tiene, y se rehace entero más abajo.
        if (prev._count.installments > 0 && !meta.terms) throw creditHasSchedule();
        const terms = dto.terms !== undefined ? parseTermsOrThrow(dto.terms) : meta.terms;
        if (!terms) throw creditTermsInvalid(['TERMS_REQUIRED']); // un crédito viejo se redefine con sus condiciones
        const r = throwOnTermsError(resolveCreditTerms(terms, { principalAmount: terms.principal }));
        const initial = dto.initialState ?? meta.initialState;
        const reg = registeredState(terms, initial);
        if (!reg.ok) throw creditInitialStateInvalid(reg.code);

        /*
         * La mora declarada es la marca manual (`moraSince`) que este campo pone. Sólo se toca si el
         * número cambió: así una marca puesta con «Marcar en mora» sobrevive a corregir la cuota, y
         * bajar la mora declarada a 0 saca la marca que ella misma había puesto.
         */
        const moraSince =
          reg.daysPastDue !== (meta.initialState?.daysPastDue ?? 0)
            ? reg.daysPastDue > 0
              ? moraSinceFromDays(reg.daysPastDue, asOf)
              : undefined
            : meta.moraSince;
        // Sin marca manual, la mora sale de la primera cuota impaga (k+1) con el método del crédito (D20).
        const byMethod = moraSince
          ? undefined
          : arrearsByMethod({ method, oldestUnpaidDue: reg.nextDueDate, balance: reg.outstandingBalance, asOf });
        const daysPastDue = moraSince ? manualArrears(moraSince, reg.outstandingBalance, asOf) : byMethod!.daysPastDue;

        Object.assign(data, {
          principalAmount: terms.principal,
          interestRate: r.interestRatePercent, // D7: sólo informativa
          installmentsCount: r.installmentsCount,
          outstandingBalance: reg.outstandingBalance,
          daysPastDue,
        });
        /*
         * Sin pagos, el cronograma guardado no tiene nada que conservar: se borra y, si las condiciones
         * nuevas son de cuota variable, se vuelve a crear con el motor. Pasar a cuota fija lo deja vacío
         * y congela la cuota, como cualquier alta con condiciones.
         */
        if (prev._count.installments > 0) await tx.creditInstallment.deleteMany({ where: { creditId: id } });
        if (r.schedule) {
          await tx.creditInstallment.createMany({
            data: installmentRows(r.schedule, initial?.paidInstallments ?? 0).map((row) => ({
              ...row,
              accountId: this.tenant.accountId,
              creditId: id,
            })),
          });
        }

        nextMeta = {
          ...nextMeta,
          installmentAmount: r.schedule ? undefined : r.installmentAmount,
          frequency: r.frequency,
          nextDueDate: reg.nextDueDate,
          balanceBasis: reg.balanceBasis,
          terms: r.terms,
          termsVersion: CREDIT_TERMS_VERSION,
          initialState: hasInitialState(initial) ? initial : undefined,
          moraSince,
          arrearsMethod: method,
          arrearsSince: byMethod?.arrearsSince,
        };
      } else if (methodChange) {
        /*
         * Sólo cambia el método: la mora se recalcula con él. Si la mora la manda una marca a mano, esa
         * sigue mandando (el método aplica a la calculada). Con cronograma, desde la cuota impaga más antigua.
         */
        nextMeta = { ...nextMeta, arrearsMethod: method };
        if (!meta.moraSince) {
          const rows =
            prev._count.installments > 0
              ? await tx.creditInstallment.findMany({ where: { creditId: id }, select: { number: true, dueDate: true, status: true } })
              : [];
          const oldestDue = rows.length > 0 ? oldestUnpaid(rows)?.dueDate : meta.nextDueDate;
          const reading = arrearsByMethod({ method, oldestUnpaidDue: oldestDue, balance: Number(prev.outstandingBalance), asOf });
          nextMeta = { ...nextMeta, arrearsSince: reading.arrearsSince };
          data.daysPastDue = reading.daysPastDue;
        }
      }

      const touchesMeta = redefine || looseField !== undefined || operational || methodChange;
      const next = await tx.credit.update({
        where: { id },
        data: { ...data, metadata: touchesMeta ? (stripUndefined(nextMeta) as Prisma.InputJsonValue) : undefined },
      });

      // Con mora al registrarlo, el caso se abre ya — igual que «Marcar en mora».
      let caseOpened = false;
      if (redefine && next.daysPastDue > 0) {
        const priority = computePriority(
          { outstandingBalance: Number(next.outstandingBalance), daysPastDue: next.daysPastDue, riskSegment: prev.client?.riskSegment },
          DEFAULT_PRIORITY_PARAMS,
        );
        caseOpened = await openCaseIfNone(tx, {
          accountId: this.tenant.accountId,
          creditId: id,
          clientId: prev.clientId,
          branchId: prev.branchId,
          assigneeId: dto.assignedManagerId ?? prev.assignedManagerId,
          priority,
          slaDueAt: slaDueAt(priority, asOf, DEFAULT_PRIORITY_PARAMS),
        });
      }
      return { before: prev, after: next, caseOpened };
    });

    const redefined = redefine ? { terms: readCreditMetadata(after.metadata).terms, initialState: dto.initialState, caseOpened } : {};
    await this.audit.record({
      entity: 'credit',
      entityId: id,
      action: 'UPDATE',
      before: creditSummary(before),
      after: { ...creditSummary(after), ...redefined },
    });
    return serializeCredit(after, config.labels);
  }

  // ── Mora declarada a mano ──────────────────────────────────────────────────
  /**
   * «Este préstamo está en mora», dicho por una persona.
   *
   * Es para quien presta sin cronograma y sabe que le deben sin mirar una fecha. Hace dos cosas y
   * las dos importan: guarda **desde cuándo** (no cuántos días — `moraSince`, para que el número
   * envejezca solo) y **abre el caso en el acto**. Lo segundo es lo que hace que el crédito aparezca
   * en Mora al instante: esperar al trabajo diario sería decirle a esa persona que su decisión vale
   * dentro de seis horas.
   *
   * 🔴 El importado no se puede marcar: su mora la manda el archivo (`arrearsSourceOf` le da
   * prioridad), así que la marca se guardaría y no haría nada. Mejor rebotar que mentir.
   */
  async markArrears(id: string, days?: number) {
    const asOf = new Date();
    const { credit, opened } = await this.tx(async (tx) => {
      const found = await tx.credit.findFirst({ where: { id, deletedAt: null }, include: { client: { select: { riskSegment: true } } } });
      if (!found) throw resourceNotFound();
      if (found.status !== CreditStatus.ACTIVE) throw creditNotActive();
      const meta = readCreditMetadata(found.metadata);
      if (isExternalOrigin(meta.origin)) throw creditLocked();

      const moraSince = moraSinceFromDays(days ?? 0, asOf);
      const daysPastDue = manualArrears(moraSince, Number(found.outstandingBalance), asOf);
      const updated = await tx.credit.update({
        where: { id },
        data: { daysPastDue, metadata: stripUndefined({ ...meta, moraSince }) as Prisma.InputJsonValue },
      });

      const priority = computePriority(
        { outstandingBalance: Number(found.outstandingBalance), daysPastDue, riskSegment: found.client.riskSegment },
        DEFAULT_PRIORITY_PARAMS,
      );
      const opened = await openCaseIfNone(tx, {
        accountId: this.tenant.accountId,
        creditId: id,
        clientId: found.clientId,
        branchId: found.branchId,
        assigneeId: found.assignedManagerId,
        priority,
        slaDueAt: slaDueAt(priority, asOf, DEFAULT_PRIORITY_PARAMS),
      });
      return { credit: updated, opened };
    });

    await this.audit.record({ entity: 'credit', entityId: id, action: 'ARREARS_MARK', after: { days: credit.daysPastDue, caseOpened: opened } });
    return serializeCredit(credit, (await this.accountConfig()).labels);
  }

  /**
   * Poner al día. **Es mover la fecha, no borrar el síntoma.**
   *
   * Un botón que sólo pusiera la mora en cero sería mentirle al sistema: la fecha seguiría vencida y
   * el trabajo diario volvería a abrir el caso esta misma noche. Así que se resuelve en una de tres
   * acciones reales, y las tres dejan el crédito con una fecha que **no** está vencida:
   *
   * · `next_period` — avanza un período según su frecuencia. Pagó la cuota, o se acordó la próxima.
   * · `date` — la fecha que se acordó. Tiene que ser futura, o esto no sirvió de nada.
   * · `none` — sin vencimiento: préstamo abierto. Sin fecha no hay mora que contar.
   *
   * Y borra la marca manual si la había: quien la puso es quien la saca. El caso se cierra con
   * motivo `CURRENT`, que es lo que después deja contar por qué se vaciaron cuarenta un martes.
   */
  async clearArrears(id: string, dto: ClearArrearsDto) {
    const asOf = new Date();
    const { credit, closed } = await this.tx(async (tx) => {
      const found = await tx.credit.findFirst({ where: { id, deletedAt: null } });
      if (!found) throw resourceNotFound();
      if (found.status !== CreditStatus.ACTIVE) throw creditNotActive();
      const meta = readCreditMetadata(found.metadata);
      if (isExternalOrigin(meta.origin)) throw creditLocked();

      let nextDueDate: string | undefined;
      if (dto.mode === 'next_period') {
        // Desde la fecha que tenía; sin ninguna, desde hoy — avanzar sobre una fecha vencida de hace
        // meses dejaría la nueva también vencida, y el caso reaparecería esta noche.
        const base = meta.nextDueDate && new Date(meta.nextDueDate) > asOf ? new Date(meta.nextDueDate) : asOf;
        nextDueDate = addPeriods(base, 1, meta.frequency).toISOString().slice(0, 10);
      } else if (dto.mode === 'date') {
        if (!dto.date) throw arrearsDateNotFuture();
        const elegida = new Date(dto.date.slice(0, 10));
        if (arrearsFromDueDate(elegida, Number(found.outstandingBalance), asOf) > 0) throw arrearsDateNotFuture();
        nextDueDate = dto.date.slice(0, 10);
      }
      // `none` deja `nextDueDate` en `undefined` → `stripUndefined` lo saca del JSON.

      const updated = await tx.credit.update({
        where: { id },
        data: {
          daysPastDue: 0,
          // Poner al día borra la marca manual y el primer atraso del método bancario (D20).
          metadata: stripUndefined({ ...meta, nextDueDate, moraSince: undefined, arrearsSince: undefined }) as Prisma.InputJsonValue,
        },
      });
      const closed = await closeOpenCases(tx, id, 'CURRENT', asOf);
      return { credit: updated, closed };
    });

    await this.audit.record({ entity: 'credit', entityId: id, action: 'ARREARS_CLEAR', after: { mode: dto.mode, casesClosed: closed } });
    return serializeCredit(credit, (await this.accountConfig()).labels);
  }

  // ── Mora ──────────────────────────────────────────────────────────────────
  async recalculateArrears(id: string, asOfInput?: string) {
    const config = await this.accountConfig();
    const asOf = asOfInput ? new Date(asOfInput) : new Date();

    const result = await this.tx(async (tx) => {
      const credit = await tx.credit.findFirst({
        where: { id, deletedAt: null },
        include: { installments: true },
      });
      if (!credit) throw resourceNotFound();

      const meta = readCreditMetadata(credit.metadata);

      // Cartera de un core ajeno: manda el valor del archivo "hasta la siguiente carga" (spec §6).
      // Sin esta guarda, un recálculo le borraba la mora que trajo la importación.
      if (isExternalOrigin(meta.origin)) {
        return { daysOverdue: credit.daysPastDue, overdueAmount: 0, interest: 0, penalty: 0, overdueInstallmentIds: [], skipped: 'EXTERNAL_ORIGIN' as const };
      }

      /*
       * 🔴 **Mora declarada a mano: tampoco se recalcula.** Es la misma idea que la guarda de arriba,
       * con otro dueño — acá el dueño es la persona que dijo «este préstamo está en mora», y la fecha
       * de vencimiento puede no existir siquiera (el prestamista que presta sin cronograma). Sin
       * esto, el recálculo le devolvía cero y el caso se cerraba solo al día siguiente de marcarlo.
       *
       * Los días igual avanzan: se derivan de `moraSince` (`manualArrears`), no se congelan.
       */
      if (meta.moraSince) {
        const daysOverdue = manualArrears(meta.moraSince, Number(credit.outstandingBalance), asOf);
        await tx.credit.update({ where: { id }, data: { daysPastDue: daysOverdue } });
        return { daysOverdue, overdueAmount: daysOverdue > 0 ? Number(credit.outstandingBalance) : 0, interest: 0, penalty: 0, overdueInstallmentIds: [], skipped: 'MANUAL_ARREARS' as const };
      }

      // Crédito sin cronograma (el del móvil): la mora sale de la próxima fecha, no de las cuotas.
      // `computeArrears` sobre un array vacío devuelve 0 y borraba la mora real.
      if (credit.installments.length === 0) {
        // D20: con el método del crédito (el bancario guarda y respeta la fecha del primer atraso).
        const reading = arrearsByMethod({
          method: meta.arrearsMethod,
          oldestUnpaidDue: meta.nextDueDate,
          arrearsSince: meta.arrearsSince,
          balance: Number(credit.outstandingBalance),
          asOf,
        });
        const daysOverdue = reading.daysPastDue;
        await tx.credit.update({
          where: { id },
          data: {
            daysPastDue: daysOverdue,
            ...(reading.arrearsSince !== meta.arrearsSince
              ? { metadata: stripUndefined({ ...meta, arrearsSince: reading.arrearsSince }) as Prisma.InputJsonValue }
              : {}),
          },
        });
        return { daysOverdue, overdueAmount: daysOverdue > 0 ? Number(credit.outstandingBalance) : 0, interest: 0, penalty: 0, overdueInstallmentIds: [] };
      }

      const arrear = computeArrears(
        credit.installments.map((i) => ({
          id: i.id,
          dueDate: i.dueDate,
          amount: Number(i.amount),
          paidAmount: Number(i.paidAmount),
          status: i.status,
        })),
        config.arrears,
        asOf,
      );

      // Marca como OVERDUE las cuotas vencidas (no pagadas).
      if (arrear.overdueInstallmentIds.length > 0) {
        await tx.creditInstallment.updateMany({
          where: { id: { in: arrear.overdueInstallmentIds }, status: { not: 'PAID' } },
          data: { status: 'OVERDUE' },
        });
      }
      // D20: el método del crédito sobre la mora de siempre (desde la cuota impaga más antigua).
      const reading = withArrearsMethod({
        baseDays: arrear.daysOverdue,
        method: meta.arrearsMethod,
        oldestUnpaidDue: oldestUnpaid(credit.installments)?.dueDate,
        arrearsSince: meta.arrearsSince,
        asOf,
      });
      arrear.daysOverdue = reading.daysPastDue;
      await tx.credit.update({
        where: { id },
        data: {
          daysPastDue: arrear.daysOverdue,
          ...(reading.arrearsSince !== meta.arrearsSince
            ? { metadata: stripUndefined({ ...meta, arrearsSince: reading.arrearsSince }) as Prisma.InputJsonValue }
            : {}),
        },
      });
      // Snapshot único por crédito (idempotente): reemplaza el anterior.
      await tx.arrear.deleteMany({ where: { creditId: id } });
      await tx.arrear.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: id,
          daysOverdue: arrear.daysOverdue,
          overdueAmount: arrear.overdueAmount,
          interest: arrear.interest,
          penalty: arrear.penalty,
          calculatedAt: asOf,
        },
      });
      return arrear;
    });

    await this.audit.record({ entity: 'credit', entityId: id, action: 'ARREARS_RECALC', after: result });
    return result;
  }
}

/**
 * `terms` del body → lo que se guarda, aplicando D14 con la función pura de shared
 * (`resolveCreditTerms`). Acá sólo se traduce cada rechazo a su error HTTP.
 */
function resolveTerms(dto: CreateCreditDto): TermsResolution {
  const terms = parseTermsOrThrow(dto.terms);
  return throwOnTermsError(
    resolveCreditTerms(terms, {
      principalAmount: dto.principalAmount,
      installmentAmount: dto.installmentAmount,
      installmentsCount: dto.installmentsCount,
      frequency: dto.frequency,
      nextDueDate: dto.nextDueDate,
      firstDueDate: dto.firstDueDate,
      interestRate: dto.interestRate,
      amortizationType: dto.amortizationType,
    }),
  );
}

function parseTermsOrThrow(raw: unknown): CreditTerms {
  const terms = parseCreditTerms(raw);
  if (!terms) throw creditTermsInvalid(['TERMS_SHAPE']);
  return terms;
}

/** El rechazo de D14 → su error HTTP. */
function throwOnTermsError(r: TermsResolution | TermsResolutionError): TermsResolution {
  if (r.ok) return r;
  switch (r.code) {
    case 'TERMS_INVALID':
      throw creditTermsInvalid(r.issues);
    case 'TERMS_CONFLICT':
      throw creditTermsConflict(r.field);
    case 'INSTALLMENT_MISMATCH':
      throw creditInstallmentMismatch(r.expected, r.sent);
  }
}

/** Una cuota a guardar en `credit_installments` (sin `accountId`/`creditId`, que pone quien la crea). */
interface InstallmentRow {
  number: number;
  dueDate: Date;
  amount: number;
  principal: number;
  interest: number;
  paidAmount?: number;
  status?: InstallmentStatus;
  paidAt?: Date;
}

/**
 * El cronograma del motor → las cuotas que se guardan (cuota variable). Las primeras `paid` ya estaban
 * pagadas al registrarlo (D13): nacen `PAID`, así la próxima fecha y la mora arrancan en la primera impaga.
 *
 * 🔴 **Sin `paidAt` y sin `Payment`.** No se cobraron en Kobrax ni se sabe cuándo se pagaron: ponerles la
 * fecha del registro las mostraría como cobradas ese día. Se reconocen por su número (≤ `paidInstallments`).
 */
function installmentRows(rows: CreditScheduleRow[], paid: number): InstallmentRow[] {
  return rows.map((r) => ({
    number: r.number,
    dueDate: new Date(`${r.dueDate}T00:00:00.000Z`),
    amount: r.amount,
    principal: r.principal,
    interest: r.interest,
    ...(r.number <= paid ? { paidAmount: r.amount, status: InstallmentStatus.PAID } : {}),
  }));
}

/** Los campos financieros sueltos de `UpdateCreditDto`: la edición anterior a las condiciones. */
const LOOSE_FINANCIAL_FIELDS = ['principalAmount', 'interestRate', 'installmentAmount', 'frequency'] as const;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Prisma rechaza `undefined` dentro de un JSON. */
function stripUndefined(meta: CreditMetadata): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Prisma.InputJsonObject;
}

/** Prioridad del caso derivada de la mora (spec §5.2). */
export function priorityFromArrears(days: number): CasePriority {
  if (days <= 0) return CasePriority.LOW;
  if (days <= 30) return CasePriority.MEDIUM;
  if (days <= 90) return CasePriority.HIGH;
  return CasePriority.CRITICAL;
}

/** Resumen plano (JSON-safe, sin Decimal/Date crudos de Prisma) para los snapshots de auditoría. */
function creditSummary(c: {
  id: string;
  clientId: string;
  code: string | null;
  principalAmount: unknown;
  outstandingBalance: unknown;
  currency: string;
  installmentsCount: number;
  status: string;
  daysPastDue: number;
  assignedManagerId: string | null;
  metadata?: unknown;
}): Record<string, unknown> {
  const meta = readCreditMetadata(c.metadata);
  return {
    id: c.id,
    clientId: c.clientId,
    code: c.code ?? undefined,
    principalAmount: Number(c.principalAmount),
    outstandingBalance: Number(c.outstandingBalance),
    currency: c.currency,
    installmentsCount: c.installmentsCount,
    status: c.status,
    daysPastDue: c.daysPastDue,
    assignedManagerId: c.assignedManagerId ?? undefined,
    // Dato financiero con traza (D13/D20): con cuántas cuotas pagadas se registró y cómo se cuenta la mora.
    initialState: meta.initialState,
    arrearsMethod: meta.arrearsMethod ?? DEFAULT_ARREARS_METHOD,
  };
}

