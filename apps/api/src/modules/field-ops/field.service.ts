import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus, CatalogType, LocationType, RouteStopStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService } from '../../common/events/event-bus.service';
import { PlanUsageAlertsService } from '../../common/plan/plan-usage-alerts.service';
import type { MonthlyCounter } from '../../common/plan/plan-limits.service';
import {
  GPS_FALLBACK_KEY,
  Permission,
  resolvePagination,
  validateVisitDetails,
  type ApiResponse,
  ResponseDto,
} from '@kobrax/shared';
import { isValidGps, verifyEvidenceHash } from './field-integrity';
import { serializeVisit, serializeVisitDetail } from './field.serializer';
import { AddEvidenceDto, CreateVisitDto, ListVisitsQueryDto } from './dto/field.dto';
import { moraScopeOf, visibleCredits } from '../mora/mora-query';
import { recordCreditActivity } from '../mora/credit-activity';
import { isUniqueViolation } from '../../common/unique-violation';
import { evidenceHashInvalid, invalidGps, invalidVisitDetails, resourceNotFound, visitCreditMismatch, visitIdTaken, visitNeedsTarget } from './field.errors';

@Injectable()
export class FieldService {
  private readonly logger = new Logger(FieldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly alerts: PlanUsageAlertsService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /**
   * El aviso del 80% del plan corre **después y aparte** (L2, R1): una visita jamás espera ni
   * falla por un cartel. Un fallo acá se loguea y nada más.
   */
  private warnPlanUsage(kind: MonthlyCounter): void {
    void this.alerts
      .check(kind)
      .catch((err: unknown) =>
        this.logger.warn(`Aviso de tope ${kind} falló: ${(err as Error)?.message ?? err}`),
      );
  }

  /**
   * `true` para el cobrador: ejecuta rutas (`ROUTE_EXECUTE`) pero no las asigna (`ROUTE_ASSIGN`) →
   * sólo ve sus propias visitas. Un rol de sólo lectura de la cuenta (auditor) **no** cae acá:
   * audita todo el tenant. Mismo criterio que rutas, casos y agenda — la capacidad, no el rol.
   */
  private scopedToOwnVisits(): boolean {
    return this.tenant.can(Permission.ROUTE_EXECUTE) && !this.tenant.can(Permission.ROUTE_ASSIGN);
  }

  /**
   * Las visitas registradas (F9 W6-T0). **Sin evidencias**: es un listado, y traer las fotos de 40
   * visitas para dibujar una tabla es tráfico que nadie mira. El detalle las trae.
   */
  async list(query: ListVisitsQueryDto): Promise<ApiResponse<ReturnType<typeof serializeVisit>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.FieldVisitWhereInput = {};
    if (query.creditId) where.creditId = query.creditId;
    if (query.routeStopId) where.routeStopId = query.routeStopId;
    // Las visitas de una ruta no cuelgan de la ruta: cuelgan de sus paradas.
    if (query.routeId) where.routeStop = { routeId: query.routeId };
    if (query.date) {
      const from = new Date(`${query.date}T00:00:00.000Z`);
      const to = new Date(from);
      to.setUTCDate(to.getUTCDate() + 1);
      where.capturedAt = { gte: from, lt: to };
    }

    /*
     * El cobrador queda acotado a lo suyo y se ignora lo que pida; **cualquier otro rol puede
     * filtrar**, incluido el auditor de sólo lectura.
     *
     * Antes el filtro vivía dentro de la rama de `ROUTE_ASSIGN`, así que un auditor que pedía
     * `?collectorId=x` recibía las visitas de TODO el tenant creyendo que miraba las de una
     * persona — y el DTO acepta el parámetro, o sea que nada avisaba que se había ignorado.
     */
    if (this.scopedToOwnVisits()) where.collectorId = this.tenant.userId;
    else if (query.collectorId) where.collectorId = query.collectorId;

    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.fieldVisit.findMany({
          where,
          // 🔴 El desempate por `id` va SIEMPRE: sin él, `LIMIT/OFFSET` repite y saltea filas entre
          // páginas cuando dos visitas comparten el instante — y en una ruta se registran seguidas.
          orderBy: [{ capturedAt: 'desc' }, { id: 'asc' }],
          skip,
          take: limit,
        }),
        tx.fieldVisit.count({ where }),
      ]),
    );

    /*
     * El punto donde se registró la visita es PII: dice dónde vive el deudor. Se audita el
     * revelado **una vez por consulta**, no una por fila — mismo criterio que el detalle de ruta y
     * el de agenda, que si no llenarían el log con una entrada por deudor mirado de reojo.
     */
    if (rows.length > 0) {
      /*
       * Entidad **`field_visit_list`**, no `field_visit`: el `entityId` de un revelado de listado es
       * quién miró, no qué se miró. Bajo el mismo nombre, cruzar el rastro contra `field_visits`
       * dejaba filas huérfanas y quien auditara una visita concreta se perdía todos los listados
       * que la revelaron. Casos ya lo resuelve así, con `case_portfolio`.
       */
      await this.audit.record({
        entity: 'field_visit_list',
        entityId: this.tenant.userId ?? 'anon',
        action: 'PII_REVEAL',
      });
    }
    return ResponseDto.paginated(rows.map(serializeVisit), total, page, limit);
  }

  /**
   * Una visita con **sus evidencias**: la foto, el punto y el hash que la sellan.
   *
   * Fuera de scope → 404 y no 403: no se filtra que exista, igual que en rutas y en casos.
   */
  async findOne(id: string): Promise<ReturnType<typeof serializeVisitDetail>> {
    const visit = await this.tx((tx) =>
      tx.fieldVisit.findFirst({
        where: { id },
        include: { evidences: { orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }] } },
      }),
    );
    if (!visit) throw resourceNotFound();
    if (this.scopedToOwnVisits() && visit.collectorId !== this.tenant.userId) throw resourceNotFound();

    await this.audit.record({ entity: 'field_visit', entityId: id, action: 'PII_REVEAL' });
    return serializeVisitDetail(visit);
  }

  /** Registra una visita de campo (append-only). GPS obligatorio. */
  async createVisit(dto: CreateVisitDto) {
    // Idempotente por `id` (cola offline del móvil). Dos envíos a la vez pasan los dos el chequeo y uno choca con la
    // PK: se repite UNA vez y esta vez el chequeo encuentra la visita que guardó el otro.
    const { visit, replay } = await this.createVisitOnce(dto).catch((err: unknown) =>
      dto.id && isUniqueViolation(err) ? this.createVisitOnce(dto) : Promise.reject(err),
    );
    const out = { id: visit.id, outcome: visit.outcome, capturedAt: visit.capturedAt };
    // Reintento: la visita ya estaba. Misma forma de respuesta, sin ubicación nueva, sin conteo de plan.
    if (replay) return out;

    const collectorId = this.tenant.userId!;
    this.events.emit('collector.location', { collectorId, lat: dto.lat, lng: dto.lng, accountId: this.tenant.accountId });
    this.warnPlanUsage('actionsPerMonth');
    return out;
  }

  private async createVisitOnce(dto: CreateVisitDto) {
    if (!dto.creditId && !dto.routeStopId) throw visitNeedsTarget();
    if (!isValidGps(dto.lat, dto.lng)) throw invalidGps();

    // Los campos propios de la variante (S5) se validan contra el `outcome` con la MISMA función que
    // corre el móvil antes de enviar: el mensaje que ve el cobrador es el que aplica el server.
    const validated = validateVisitDetails(dto.outcome, dto.details);
    if (!validated.ok) throw invalidVisitDetails(validated.errors);

    const collectorId = this.tenant.userId!;
    return this.tx(async (tx) => {
      if (dto.id) {
        const prev = await tx.fieldVisit.findFirst({ where: { id: dto.id } });
        if (prev) {
          const same = (!dto.creditId || prev.creditId === dto.creditId) && (prev.routeStopId ?? null) === (dto.routeStopId ?? null) && prev.collectorId === collectorId;
          if (!same) throw visitIdTaken();
          return { visit: prev, replay: true };
        }
      }
      // Además de existir, la parada trae su punto conocido: es lo que deja al server DERIVAR el
      // flag de GPS estimado en vez de creerle al body (ver `gpsEstimado` más abajo) y su crédito.
      let stopPoint: { latitude: number; longitude: number } | undefined;
      let stopAgendaItemId: string | null = null;
      let creditId: string | undefined = dto.creditId;
      if (dto.routeStopId) {
        const s = await tx.routeStop.findFirst({
          where: { id: dto.routeStopId },
          select: { id: true, creditId: true, agendaItemId: true, client: { select: { locations: { select: { locationType: true, latitude: true, longitude: true } } } } },
        });
        if (!s) throw resourceNotFound();
        stopAgendaItemId = s.agendaItemId;
        if (dto.creditId && s.creditId && s.creditId !== dto.creditId) throw visitCreditMismatch();
        creditId = dto.creditId ?? s.creditId ?? undefined; // una visita por parada resuelve el crédito de la parada
        const loc =
          s.client?.locations.find((l) => l.locationType === LocationType.HOME) ?? s.client?.locations[0];
        if (loc?.latitude != null && loc.longitude != null) {
          stopPoint = { latitude: Number(loc.latitude), longitude: Number(loc.longitude) };
        }
      }
      // El crédito debe estar a la vista de quien visita: el mismo alcance que la ficha de mora y la agenda
      // (responsable, temporal o apoyo; supervisor = su agencia). Fuera de alcance → 404, no se filtra que existe.
      let credit: { id: string; clientId: string } | undefined;
      if (creditId) {
        [credit] = await visibleCredits(tx, moraScopeOf(this.tenant), { creditId });
        if (!credit) throw resourceNotFound();
      }
      // El cruce que el validador puro no puede hacer: que la categoría exista en el catálogo de
      // ESTE tenant y esté activa. Mismo criterio que los motivos de agenda S6.
      if ('categoryCode' in validated.value) {
        const cat = await tx.catalogItem.findFirst({
          where: { catalog: CatalogType.SPECIAL_CATEGORY, code: validated.value.categoryCode, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (!cat) throw invalidVisitDetails(['categoryCode: la categoría no existe o está inactiva']);
      }
      const gpsEstimado =
        dto.gpsFallback === true ||
        (stopPoint != null && stopPoint.latitude === dto.lat && stopPoint.longitude === dto.lng);

      const created = await tx.fieldVisit.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          accountId: this.tenant.accountId,
          creditId: credit?.id,
          routeStopId: dto.routeStopId,
          collectorId,
          latitude: dto.lat,
          longitude: dto.lng,
          accuracy: dto.accuracy,
          outcome: dto.outcome,
          notes: dto.notes,
          // El flag va fuera de `details` (el validador descarta lo que venga ahí) y lo escribe el
          // server. `dto.gpsFallback` es lo que DECLARA el cliente, y por sí solo no alcanza: quien
          // mande una coordenada inventada y omita el flag produciría una visita que una auditoría
          // lee como GPS real. Por eso también se DERIVA: en el camino de respaldo el móvil manda
          // exactamente el punto de la parada, y eso el server lo puede comprobar contra su base.
          details: { ...validated.value, ...(gpsEstimado ? { [GPS_FALLBACK_KEY]: true } : {}) },
          capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
        },
      });
      // La parada visitada se marca.
      if (dto.routeStopId) {
        await tx.routeStop.update({ where: { id: dto.routeStopId }, data: { status: RouteStopStatus.VISITED, visitedAt: new Date() } });
      }
      // La gestión queda en la bitácora del crédito (con el episodio abierto si lo hay) y su «última gestión».
      if (credit) {
        const activity = await recordCreditActivity(tx, { accountId: this.tenant.accountId, creditId: credit.id, clientId: credit.clientId, userId: collectorId, type: 'VISIT', result: dto.outcome, notes: dto.notes });
        // 🔴 Si la parada nació de una visita agendada, ESA gestión se cierra con la misma actividad (F4/11 · E1): una
        // sola ejecución, en la misma transacción. Si la gestión ya no está pendiente (la cancelaron o reagendaron
        // mientras tanto) no se toca: la visita se registra igual.
        if (stopAgendaItemId) {
          await tx.agendaItem.updateMany({
            where: { id: stopAgendaItemId, status: AgendaItemStatus.SCHEDULED, deletedAt: null },
            data: { status: AgendaItemStatus.EXECUTED, resultActivityId: activity.id, updatedBy: collectorId },
          });
        }
      }
      // Última ubicación conocida del cobrador (users es global, sin RLS).
      await tx.user.update({ where: { id: collectorId }, data: { lastKnownLat: dto.lat, lastKnownLng: dto.lng, lastLocationAt: new Date() } });
      return { visit: created, replay: false };
    });
  }

  /** Añade evidencia sellada a una visita (inmutable). Verifica el hash SHA-256 si llega el contenido. */
  async addEvidence(visitId: string, dto: AddEvidenceDto) {
    if (dto.content && !verifyEvidenceHash(dto.content, dto.fileHash)) throw evidenceHashInvalid();

    const evidence = await this.tx(async (tx) => {
      const visit = await tx.fieldVisit.findFirst({ where: { id: visitId }, select: { id: true, latitude: true, longitude: true } });
      if (!visit) throw resourceNotFound();
      return tx.fieldEvidence.create({
        data: {
          accountId: this.tenant.accountId,
          visitId,
          type: dto.type,
          fileUrl: dto.fileUrl,
          fileHash: dto.fileHash.trim().toLowerCase(),
          latitude: visit.latitude,
          longitude: visit.longitude,
          capturedAt: new Date(),
        },
      });
    });
    await this.audit.record({ entity: 'field_evidence', entityId: evidence.id, action: 'CREATE', after: { visitId, type: dto.type, fileHash: evidence.fileHash } });
    this.warnPlanUsage('photosPerMonth');
    return { id: evidence.id, type: evidence.type, fileHash: evidence.fileHash };
  }
}
