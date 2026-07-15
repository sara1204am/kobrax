import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ClientType } from '@prisma/client';
import { resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BlindIndexService } from '../../common/crypto/blind-index.service';
import { AuditService } from '../../common/audit/audit.service';
import { serializeClient } from './clients.serializer';
import {
  CreateAttachmentDto,
  CreateClientDto,
  CreateContactDto,
  CreateLocationDto,
  CreateRelationDto,
  ListClientsQueryDto,
  UpdateClientDto,
  UpdateContactDto,
} from './dto/client.dto';
import {
  clientDuplicate,
  clientHasActiveCredits,
  invalidClientIdentity,
  resourceNotFound,
} from './clients.errors';

/** PII del cliente que se redacta en los snapshots de auditoría. */
const CLIENT_REDACT = ['nationalId', 'taxId', 'value', 'address', 'phone'];

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly crypto: CryptoService,
    private readonly blind: BlindIndexService,
    private readonly audit: AuditService,
  ) {}

  /** Ejecuta `fn` en el contexto RLS del tenant actual (del TenantContextService). */
  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private enc(value?: string | null): string | null {
    return value ? this.crypto.encrypt(value) : null;
  }

  // ── Clientes ────────────────────────────────────────────────────────────────
  async create(dto: CreateClientDto): Promise<ReturnType<typeof serializeClient>> {
    this.assertIdentity(dto.clientType, dto.firstName, dto.lastName, dto.businessName);
    const nationalIdHash = this.blind.hash(dto.nationalId);

    const { created, subs } = await this.tx(async (tx) => {
      if (nationalIdHash) {
        const dup = await tx.client.findFirst({ where: { nationalIdHash } });
        if (dup) throw clientDuplicate();
      }
      let client: Awaited<ReturnType<typeof tx.client.create>>;
      try {
        client = await tx.client.create({
          data: {
            accountId: this.tenant.accountId,
            clientType: dto.clientType,
            firstName: dto.firstName,
            lastName: dto.lastName,
            businessName: dto.businessName,
            gender: dto.gender,
            nationalId: this.enc(dto.nationalId),
            nationalIdHash,
            taxId: this.enc(dto.taxId),
            status: dto.status,
            preferredContactChannel: dto.preferredContactChannel,
            riskSegment: dto.riskSegment,
            metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        if (this.isUniqueViolation(e)) throw clientDuplicate(); // carrera contra el índice único
        throw e;
      }

      // Alta atómica (§5.1): teléfono + ubicación en la MISMA transacción → sin cliente huérfano si algo falla.
      const audits: { kind: string; id: string; after: unknown }[] = [];
      for (const c of dto.contacts ?? []) {
        const row = await tx.clientContact.create({
          data: {
            accountId: this.tenant.accountId,
            clientId: client.id,
            contactType: c.contactType,
            value: this.crypto.encrypt(c.value),
            isPrimary: c.isPrimary ?? false,
            notes: c.notes,
          },
        });
        audits.push({ kind: 'contact', id: row.id, after: row });
      }
      for (const l of dto.locations ?? []) {
        const row = await tx.clientLocation.create({
          data: {
            accountId: this.tenant.accountId,
            clientId: client.id,
            locationType: l.locationType,
            address: this.enc(l.address),
            zone: l.zone,
            latitude: l.latitude,
            longitude: l.longitude,
            referenceNotes: l.referenceNotes,
            photoUrls: (l.photoUrls ?? []) as Prisma.InputJsonValue,
          },
        });
        audits.push({ kind: 'location', id: row.id, after: row });
      }
      // Relaciones/garantes (§5.1, red de contactos). `phone` va en claro (no es PII del deudor).
      for (const r of dto.relations ?? []) {
        const row = await tx.clientRelation.create({
          data: {
            accountId: this.tenant.accountId,
            clientId: client.id,
            relatedName: r.relatedName,
            relationshipType: r.relationshipType,
            gender: r.gender,
            phone: r.phone,
            isContactable: r.isContactable ?? true,
            notes: r.notes,
          },
        });
        audits.push({ kind: 'relation', id: row.id, after: row });
      }
      return { created: client, subs: audits };
    });

    // Audit fuera del tx (audit.record abre su propio withTenant), como en update().
    await this.audit.record({ entity: 'client', entityId: created.id, action: 'CREATE', after: created, redactKeys: CLIENT_REDACT });
    for (const s of subs) {
      await this.audit.record({ entity: `client_${s.kind}`, entityId: s.id, action: 'CREATE', after: s.after, redactKeys: CLIENT_REDACT });
    }
    return serializeClient(created, { crypto: this.crypto, reveal: false });
  }

  async list(query: ListClientsQueryDto): Promise<ApiResponse<ReturnType<typeof serializeClient>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.ClientWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.risk) where.riskSegment = query.risk;
    if (query.q) {
      const docHash = this.blind.hash(query.q);
      where.OR = [
        ...(docHash ? [{ nationalIdHash: docHash }] : []),
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { businessName: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.client.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        tx.client.count({ where }),
      ]),
    );

    const data = rows.map((c) => serializeClient(c, { crypto: this.crypto, reveal: false }));
    return ResponseDto.paginated(data, total, page, limit);
  }

  async findOne(id: string, reveal: boolean): Promise<ReturnType<typeof serializeClient>> {
    const client = await this.tx((tx) =>
      tx.client.findFirst({
        where: { id, deletedAt: null },
        include: { contacts: true, locations: true, relations: true, attachments: true },
      }),
    );
    if (!client) throw resourceNotFound();

    if (reveal) {
      // Acceso a PII en claro → queda auditado (data_access_log detallado llega en F12).
      await this.audit.record({ entity: 'client', entityId: id, action: 'PII_REVEAL' });
    }
    return serializeClient(client, { crypto: this.crypto, reveal });
  }

  async update(id: string, dto: UpdateClientDto): Promise<ReturnType<typeof serializeClient>> {
    const { before, after } = await this.tx(async (tx) => {
      const prev = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!prev) throw resourceNotFound();

      const data: Prisma.ClientUpdateInput = {
        firstName: dto.firstName,
        lastName: dto.lastName,
        businessName: dto.businessName,
        gender: dto.gender,
        status: dto.status,
        preferredContactChannel: dto.preferredContactChannel,
        riskSegment: dto.riskSegment,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      };
      if (dto.nationalId !== undefined) {
        const hash = this.blind.hash(dto.nationalId);
        if (hash) {
          const dup = await tx.client.findFirst({ where: { nationalIdHash: hash, id: { not: id } } });
          if (dup) throw clientDuplicate();
        }
        data.nationalId = this.enc(dto.nationalId);
        data.nationalIdHash = hash;
      }
      if (dto.taxId !== undefined) data.taxId = this.enc(dto.taxId);

      const next = await tx.client.update({ where: { id }, data });
      return { before: prev, after: next };
    });
    // Audit fuera del tx para no anidar transacciones (audit.record abre su propio withTenant).
    await this.audit.record({ entity: 'client', entityId: after.id, action: 'UPDATE', before, after, redactKeys: CLIENT_REDACT });
    return serializeClient(after, { crypto: this.crypto, reveal: false });
  }

  async remove(id: string): Promise<void> {
    await this.tx(async (tx) => {
      const client = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!client) throw resourceNotFound();
      const activeCredits = await tx.credit.count({ where: { clientId: id, status: 'ACTIVE', deletedAt: null } });
      if (activeCredits > 0) throw clientHasActiveCredits();
      await tx.client.update({ where: { id }, data: { status: 'INACTIVE', deletedAt: new Date() } });
    });
    await this.audit.record({ entity: 'client', entityId: id, action: 'DELETE' });
  }

  // ── Sub-recursos ──────────────────────────────────────────────────────────
  async addContact(clientId: string, dto: CreateContactDto) {
    return this.subCreate(clientId, 'contact', (tx) =>
      tx.clientContact.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          contactType: dto.contactType,
          value: this.crypto.encrypt(dto.value),
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes,
        },
      }),
    );
  }

  async updateContact(clientId: string, contactId: string, dto: UpdateContactDto) {
    const updated = await this.tx(async (tx) => {
      const existing = await tx.clientContact.findFirst({ where: { id: contactId, clientId } });
      if (!existing) throw resourceNotFound();
      return tx.clientContact.update({
        where: { id: contactId },
        data: {
          contactType: dto.contactType,
          value: dto.value !== undefined ? this.crypto.encrypt(dto.value) : undefined,
          isPrimary: dto.isPrimary,
          isVerified: dto.isVerified,
          notes: dto.notes,
        },
      });
    });
    await this.audit.record({ entity: 'client_contact', entityId: contactId, action: 'UPDATE', after: updated, redactKeys: CLIENT_REDACT });
    return updated;
  }

  async addLocation(clientId: string, dto: CreateLocationDto) {
    return this.subCreate(clientId, 'location', (tx) =>
      tx.clientLocation.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          locationType: dto.locationType,
          address: this.enc(dto.address),
          zone: dto.zone,
          latitude: dto.latitude,
          longitude: dto.longitude,
          referenceNotes: dto.referenceNotes,
          photoUrls: (dto.photoUrls ?? []) as Prisma.InputJsonValue,
          visitSchedule: dto.visitSchedule as Prisma.InputJsonValue | undefined,
          riskLevel: dto.riskLevel,
        },
      }),
    );
  }

  async addRelation(clientId: string, dto: CreateRelationDto) {
    return this.subCreate(clientId, 'relation', (tx) =>
      tx.clientRelation.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          relatedName: dto.relatedName,
          relationshipType: dto.relationshipType,
          gender: dto.gender,
          phone: dto.phone,
          isContactable: dto.isContactable ?? true,
          notes: dto.notes,
        },
      }),
    );
  }

  async addAttachment(clientId: string, dto: CreateAttachmentDto) {
    return this.subCreate(clientId, 'attachment', (tx) =>
      tx.clientAttachment.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          fileType: dto.fileType,
          fileUrl: dto.fileUrl,
          fileHash: dto.fileHash,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      }),
    );
  }

  /** Baja de un sub-recurso (contact/location/relation/attachment). Scoped por cliente + RLS. */
  async removeSub(
    clientId: string,
    kind: 'contact' | 'location' | 'relation' | 'attachment',
    subId: string,
  ): Promise<void> {
    const res = await this.tx((tx) => {
      const where = { id: subId, clientId };
      switch (kind) {
        case 'contact':
          return tx.clientContact.deleteMany({ where });
        case 'location':
          return tx.clientLocation.deleteMany({ where });
        case 'relation':
          return tx.clientRelation.deleteMany({ where });
        case 'attachment':
          return tx.clientAttachment.deleteMany({ where });
      }
    });
    if (!res || res.count === 0) throw resourceNotFound();
    await this.audit.record({ entity: `client_${kind}`, entityId: subId, action: 'DELETE' });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private async subCreate<T extends { id: string }>(
    clientId: string,
    kind: string,
    create: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const result = await this.tx(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true } });
      if (!client) throw resourceNotFound();
      return create(tx);
    });
    await this.audit.record({ entity: `client_${kind}`, entityId: result.id, action: 'CREATE', after: result, redactKeys: CLIENT_REDACT });
    return result;
  }

  private assertIdentity(type: ClientType, first?: string, last?: string, business?: string): void {
    if (type === ClientType.PERSON && !(first && last)) {
      throw invalidClientIdentity('Una persona requiere nombre y apellido');
    }
    if (type === ClientType.COMPANY && !business) {
      throw invalidClientIdentity('Una empresa requiere razón social (businessName)');
    }
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }
}
