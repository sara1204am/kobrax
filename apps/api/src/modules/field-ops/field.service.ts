import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { RouteStopStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService } from '../../common/events/event-bus.service';
import { isValidGps, verifyEvidenceHash } from './field-integrity';
import { AddEvidenceDto, CreateVisitDto } from './dto/field.dto';
import { evidenceHashInvalid, invalidGps, resourceNotFound, visitNeedsTarget } from './field.errors';

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

  /** Registra una visita de campo (append-only). GPS obligatorio. */
  async createVisit(dto: CreateVisitDto) {
    if (!dto.caseId && !dto.routeStopId) throw visitNeedsTarget();
    if (!isValidGps(dto.lat, dto.lng)) throw invalidGps();

    const collectorId = this.tenant.userId!;
    const visit = await this.tx(async (tx) => {
      if (dto.caseId) {
        const c = await tx.collectionCase.findFirst({ where: { id: dto.caseId, deletedAt: null }, select: { id: true } });
        if (!c) throw resourceNotFound();
      }
      if (dto.routeStopId) {
        const s = await tx.routeStop.findFirst({ where: { id: dto.routeStopId }, select: { id: true } });
        if (!s) throw resourceNotFound();
      }
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
