import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CatalogType, LocationType, RouteStopStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService } from '../../common/events/event-bus.service';
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
import { evidenceHashInvalid, invalidGps, invalidVisitDetails, resourceNotFound, visitNeedsTarget } from './field.errors';

@Injectable()
export class FieldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
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
    if (query.caseId) where.caseId = query.caseId;
    if (query.routeStopId) where.routeStopId = query.routeStopId;
    // Las visitas de una ruta no cuelgan de la ruta: cuelgan de sus paradas.
    if (query.routeId) where.routeStop = { routeId: query.routeId };
    if (query.date) {
      const from = new Date(`${query.date}T00:00:00.000Z`);
      const to = new Date(from);
      to.setUTCDate(to.getUTCDate() + 1);
      where.capturedAt = { gte: from, lt: to };
    }

    if (this.tenant.can(Permission.ROUTE_ASSIGN)) {
      if (query.collectorId) where.collectorId = query.collectorId;
    } else if (this.scopedToOwnVisits()) {
      where.collectorId = this.tenant.userId;
    }

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
      await this.audit.record({ entity: 'field_visit', entityId: this.tenant.userId ?? 'anon', action: 'PII_REVEAL' });
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
    if (!dto.caseId && !dto.routeStopId) throw visitNeedsTarget();
    if (!isValidGps(dto.lat, dto.lng)) throw invalidGps();

    // Los campos propios de la variante (S5) se validan contra el `outcome` con la MISMA función que
    // corre el móvil antes de enviar: el mensaje que ve el cobrador es el que aplica el server.
    const validated = validateVisitDetails(dto.outcome, dto.details);
    if (!validated.ok) throw invalidVisitDetails(validated.errors);

    const collectorId = this.tenant.userId!;
    const visit = await this.tx(async (tx) => {
      if (dto.caseId) {
        const c = await tx.collectionCase.findFirst({ where: { id: dto.caseId, deletedAt: null }, select: { id: true } });
        if (!c) throw resourceNotFound();
      }
      // Además de existir, la parada trae su punto conocido: es lo que deja al server DERIVAR el
      // flag de GPS estimado en vez de creerle al body (ver `gpsEstimado` más abajo).
      let stopPoint: { latitude: number; longitude: number } | undefined;
      if (dto.routeStopId) {
        const s = await tx.routeStop.findFirst({
          where: { id: dto.routeStopId },
          select: { id: true, client: { select: { locations: { select: { locationType: true, latitude: true, longitude: true } } } } },
        });
        if (!s) throw resourceNotFound();
        const loc =
          s.client?.locations.find((l) => l.locationType === LocationType.HOME) ?? s.client?.locations[0];
        if (loc?.latitude != null && loc.longitude != null) {
          stopPoint = { latitude: Number(loc.latitude), longitude: Number(loc.longitude) };
        }
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
          accountId: this.tenant.accountId,
          caseId: dto.caseId,
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
      // La parada visitada se marca; el caso queda con su última gestión.
      if (dto.routeStopId) {
        await tx.routeStop.update({ where: { id: dto.routeStopId }, data: { status: RouteStopStatus.VISITED, visitedAt: new Date() } });
      }
      if (dto.caseId) {
        await tx.collectionCase.update({ where: { id: dto.caseId }, data: { lastActionAt: new Date() } });
        await tx.caseActivity.create({ data: { accountId: this.tenant.accountId, caseId: dto.caseId, userId: collectorId, type: 'VISIT', result: dto.outcome, notes: dto.notes } });
      }
      // Última ubicación conocida del cobrador (users es global, sin RLS).
      await tx.user.update({ where: { id: collectorId }, data: { lastKnownLat: dto.lat, lastKnownLng: dto.lng, lastLocationAt: new Date() } });
      return created;
    });

    this.events.emit('collector.location', { collectorId, lat: dto.lat, lng: dto.lng, accountId: this.tenant.accountId });
    return { id: visit.id, outcome: visit.outcome, capturedAt: visit.capturedAt };
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
    return { id: evidence.id, type: evidence.type, fileHash: evidence.fileHash };
  }
}
