import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
// `Prisma` entra como valor y no sólo como tipo: la cartera arma su SQL con `Prisma.sql` (§W3).
import { ClientType, Prisma } from '@prisma/client';
import { resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BlindIndexService } from '../../common/crypto/blind-index.service';
import { AuditService } from '../../common/audit/audit.service';
import { serializeClient, type PortfolioClient, type PortfolioTotals } from './clients.serializer';
import {
  CreateAttachmentDto,
  CreateClientDto,
  CreateContactDto,
  CreateLocationDto,
  UpdateLocationDto,
  UpdateRelationDto,
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

/** Fila cruda de la cartera: nombres de columna de PostgreSQL, sin pasar por Prisma. */
interface PortfolioRow {
  id: string;
  total_debt: number;
  max_days_past_due: number;
  credit_count: number;
}

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

    const { created, subs, yaExistia } = await this.tx(async (tx) => {
      // Alta idempotente: si el móvil propuso un id y ese cliente ya está, esta llamada es el
      // reintento de una alta encolada sin señal — se devuelve el existente en vez de crear un
      // duplicado. Se chequea ANTES que el documento para no confundir "es el mismo alta" con
      // "ya hay otro cliente con ese CI", que sí es un error que el cobrador tiene que ver.
      if (dto.id) {
        const previo = await tx.client.findFirst({ where: { id: dto.id, deletedAt: null } });
        if (previo) return { created: previo, subs: [], yaExistia: true };
      }
      if (nationalIdHash) {
        const dup = await tx.client.findFirst({ where: { nationalIdHash } });
        if (dup) throw clientDuplicate();
      }
      let client: Awaited<ReturnType<typeof tx.client.create>>;
      try {
        client = await tx.client.create({
          data: {
            // Sólo si el móvil lo propuso (ver `CreateClientDto.id`).
            ...(dto.id ? { id: dto.id } : {}),
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

      // Alta atómica (§5.1): teléfonos + ubicaciones + relaciones en la MISMA transacción → sin cliente
      // huérfano si algo falla. Teléfonos/ubicaciones cuelgan del cliente (relationId null) o de un
      // contacto/relación (relationId set) — mismas tablas, misma lógica.
      const audits: { kind: string; id: string; after: unknown }[] = [];
      const acc = this.tenant.accountId;
      const mkContact = async (c: CreateContactDto, relationId: string | null) => {
        const row = await tx.clientContact.create({
          data: { accountId: acc, clientId: client.id, relationId, contactType: c.contactType, value: this.crypto.encrypt(c.value), isPrimary: c.isPrimary ?? false, notes: c.notes },
        });
        audits.push({ kind: 'contact', id: row.id, after: row });
      };
      const mkLocation = async (l: CreateLocationDto, relationId: string | null) => {
        const row = await tx.clientLocation.create({
          data: { accountId: acc, clientId: client.id, relationId, locationType: l.locationType, address: this.enc(l.address), zone: l.zone, latitude: l.latitude, longitude: l.longitude, referenceNotes: l.referenceNotes, photoUrls: (l.photoUrls ?? []) as Prisma.InputJsonValue },
        });
        audits.push({ kind: 'location', id: row.id, after: row });
      };

      for (const c of dto.contacts ?? []) await mkContact(c, null);
      for (const l of dto.locations ?? []) await mkLocation(l, null);
      for (const r of dto.relations ?? []) {
        const rel = await tx.clientRelation.create({
          data: { accountId: acc, clientId: client.id, relatedName: r.relatedName, relationshipType: r.relationshipType, gender: r.gender, isContactable: r.isContactable ?? true, notes: r.notes },
        });
        audits.push({ kind: 'relation', id: rel.id, after: rel });
        for (const c of r.contacts ?? []) await mkContact(c, rel.id); // teléfonos del contacto
        for (const l of r.locations ?? []) await mkLocation(l, rel.id); // ubicaciones del contacto
      }
      return { created: client, subs: audits, yaExistia: false };
    });

    // Un reintento no vuelve a auditar: el alta ya quedó registrada la primera vez.
    if (yaExistia) return serializeClient(created, { crypto: this.crypto, reveal: false });

    // Audit fuera del tx (audit.record abre su propio withTenant), como en update().
    await this.audit.record({ entity: 'client', entityId: created.id, action: 'CREATE', after: created, redactKeys: CLIENT_REDACT });
    for (const s of subs) {
      await this.audit.record({ entity: `client_${s.kind}`, entityId: s.id, action: 'CREATE', after: s.after, redactKeys: CLIENT_REDACT });
    }
    return serializeClient(created, { crypto: this.crypto, reveal: false });
  }

  /** Los totales son `Partial` porque sólo vienen con `view=portfolio` (§W3). */
  async list(
    query: ListClientsQueryDto,
  ): Promise<ApiResponse<(ReturnType<typeof serializeClient> & Partial<PortfolioTotals>)[]>> {
    const { page, limit, skip } = resolvePagination(query);
    if (query.view === 'portfolio') return this.listPortfolio(query, page, limit, skip);

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

  /**
   * La cartera del panel web: cada cliente con su deuda agregada, su peor mora y cuántos créditos
   * tiene, **ordenada por eso**.
   *
   * Va en SQL crudo porque no se puede resolver de otra forma: la mora de un cliente es el `MAX` de
   * sus créditos y la deuda su `SUM`, así que si primero se paginan 20 clientes y después se los
   * enriquece, se ordenaron 20 cualesquiera. Prisma sabe ordenar por el `_count` de una relación,
   * pero no por `SUM` ni por `MAX`: el orden y la agregación son la misma consulta.
   *
   * Corre dentro de `withTenant`, o sea bajo la policy `tenant_isolation` de `clients` y `credits`
   * (definida en `prisma/rls/001_enable_rls.sql`, **no** entre las migraciones). Por eso no filtra
   * `account_id` a mano; fuera de ese contexto no devuelve nada.
   */
  private async listPortfolio(
    query: ListClientsQueryDto,
    page: number,
    limit: number,
    skip: number,
  ): Promise<ApiResponse<PortfolioClient[]>> {
    const where = this.portfolioWhere(query);
    // 🔴 El filtro de créditos va en el `ON` y NO en el `WHERE`: en el `WHERE`, este `LEFT JOIN` se
    // comporta como `INNER` y los clientes sin créditos desaparecen de la cartera. Hay un spec que
    // lo mira, porque el síntoma —una lista a la que le faltan los clientes recién dados de alta—
    // no se parece en nada a su causa.
    const página = Prisma.sql`
      SELECT c.id,
             COALESCE(SUM(cr.outstanding_balance), 0)::float8 AS total_debt,
             COALESCE(MAX(cr.days_past_due), 0)::int          AS max_days_past_due,
             COUNT(cr.id)::int                                AS credit_count
      FROM clients c
      LEFT JOIN credits cr ON cr.client_id = c.id AND cr.deleted_at IS NULL
      WHERE ${where}
      GROUP BY c.id
      ORDER BY ${this.portfolioOrder(query)}
      LIMIT ${limit} OFFSET ${skip}`;
    const cuenta = Prisma.sql`SELECT COUNT(*)::int AS total FROM clients c WHERE ${where}`;

    const [rows, totals] = await this.tx((tx) =>
      Promise.all([tx.$queryRaw<PortfolioRow[]>(página), tx.$queryRaw<{ total: number }[]>(cuenta)]),
    );

    const ids = rows.map((r) => r.id);
    const clients = await this.tx((tx) => tx.client.findMany({ where: { id: { in: ids } } }));
    // Prisma no garantiza el orden del `IN`, y el orden es justamente lo que pidió la consulta.
    const byId = new Map(clients.map((c) => [c.id, c]));
    const data = rows.flatMap((r) => {
      const client = byId.get(r.id);
      if (!client) return []; // borrado entre las dos consultas
      return [
        {
          ...serializeClient(client, { crypto: this.crypto, reveal: false }),
          totalDebt: Math.round(r.total_debt * 100) / 100,
          maxDaysPastDue: r.max_days_past_due,
          creditCount: r.credit_count,
        },
      ];
    });
    return ResponseDto.paginated(data, totals[0]?.total ?? 0, page, limit);
  }

  /**
   * El `WHERE` de la cartera. Es el espejo en SQL del `where` de `list()` — se escribe dos veces
   * porque los dos caminos hablan idiomas distintos, y un spec verifica que devuelvan los mismos
   * clientes para los mismos filtros.
   *
   * `q` va parametrizado, nunca interpolado: es texto que escribe cualquiera en una caja de búsqueda.
   */
  private portfolioWhere(query: ListClientsQueryDto): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`c.deleted_at IS NULL`];
    // El estado del cliente es la columna `client_status`, no `status`.
    if (query.status) conds.push(Prisma.sql`c.client_status = ${query.status}::"ClientStatus"`);
    if (query.risk) conds.push(Prisma.sql`c.risk_segment = ${query.risk}`);
    if (query.q) {
      const like = `%${query.q}%`;
      const docHash = this.blind.hash(query.q);
      const porNombre = Prisma.sql`c.first_name ILIKE ${like} OR c.last_name ILIKE ${like} OR c.business_name ILIKE ${like}`;
      // El documento está cifrado: matchea exacto por blind index o no matchea.
      conds.push(docHash ? Prisma.sql`(c.national_id_hash = ${docHash} OR ${porNombre})` : Prisma.sql`(${porNombre})`);
    }
    return Prisma.join(conds, ' AND ');
  }

  /**
   * El orden. Siempre termina en `c.id`: sin un desempate determinista, dos clientes con la misma
   * mora pueden intercambiarse entre página y página, y con `LIMIT/OFFSET` eso repite o saltea filas.
   */
  private portfolioOrder(query: ListClientsQueryDto): Prisma.Sql {
    const desc = (query.dir ?? 'desc') === 'desc';
    const dir = desc ? Prisma.raw('DESC') : Prisma.raw('ASC');
    switch (query.sort ?? 'dpd') {
      case 'debt':
        return Prisma.sql`total_debt ${dir}, c.id`;
      case 'name':
        return Prisma.sql`COALESCE(c.business_name, c.last_name, c.first_name) ${dir}, c.id`;
      case 'status':
        return Prisma.sql`c.client_status ${dir}, c.id`;
      case 'createdAt':
        return Prisma.sql`c.created_at ${dir}, c.id`;
      case 'dpd':
      default:
        // La mora manda y la deuda desempata: entre dos que deben hace los mismos días, primero el
        // que debe más. Es el orden con el que abre la pantalla.
        return Prisma.sql`max_days_past_due ${dir}, total_debt ${dir}, c.id`;
    }
  }

  async findOne(id: string, reveal: boolean): Promise<ReturnType<typeof serializeClient>> {
    const client = await this.tx((tx) =>
      tx.client.findFirst({
        where: { id, deletedAt: null },
        include: {
          // Los teléfonos/ubicaciones del cliente = los que NO cuelgan de una relación (relationId null).
          contacts: { where: { relationId: null } },
          locations: { where: { relationId: null } },
          // Cada contacto/relación trae los suyos.
          relations: { include: { contacts: true, locations: true } },
          attachments: true,
        },
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
  /**
   * `relationId` cuelga el teléfono de un garante en vez del cliente (misma tabla, así lo modela el
   * schema). Sin esto, el teléfono de un garante sólo se podía cargar creando al garante entero.
   */
  async addContact(clientId: string, dto: CreateContactDto) {
    return this.subCreate(clientId, 'contact', async (tx) => {
      await this.assertRelationOf(tx, clientId, dto.relationId);
      return tx.clientContact.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          relationId: dto.relationId,
          contactType: dto.contactType,
          value: this.crypto.encrypt(dto.value),
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes,
        },
      });
    });
  }

  /** El garante tiene que ser de ESTE cliente: si no, se le colgarían datos a un tercero. */
  private async assertRelationOf(tx: PrismaClient, clientId: string, relationId?: string): Promise<void> {
    if (!relationId) return;
    const rel = await tx.clientRelation.findFirst({ where: { id: relationId, clientId }, select: { id: true } });
    if (!rel) throw resourceNotFound();
  }

  /** Edita los datos de un garante (nombre, tipo de relación, notas…). */
  async updateRelation(clientId: string, relationId: string, dto: UpdateRelationDto) {
    const updated = await this.tx(async (tx) => {
      const existing = await tx.clientRelation.findFirst({ where: { id: relationId, clientId }, select: { id: true } });
      if (!existing) throw resourceNotFound();
      return tx.clientRelation.update({
        where: { id: relationId },
        data: {
          ...(dto.relatedName !== undefined && { relatedName: dto.relatedName }),
          ...(dto.relationshipType !== undefined && { relationshipType: dto.relationshipType }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(dto.isContactable !== undefined && { isContactable: dto.isContactable }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
      });
    });
    await this.audit.record({ entity: 'client_relation', entityId: relationId, action: 'UPDATE', after: updated, redactKeys: CLIENT_REDACT });
    return updated;
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

  /** `relationId`: la ubicación es del garante, no del cliente (ídem `addContact`). */
  async addLocation(clientId: string, dto: CreateLocationDto) {
    return this.subCreate(clientId, 'location', async (tx) => {
      await this.assertRelationOf(tx, clientId, dto.relationId);
      return tx.clientLocation.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          relationId: dto.relationId,
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
      });
    });
  }

  /**
   * Corrige una ubicación existente. Sin esto, arreglar una dirección o marcarle el punto obliga a
   * borrarla y crear otra: cambia el id y se pierden sus fotos y su referencia. Sólo se escriben los
   * campos que vienen — `address` se cifra como en el alta.
   */
  async updateLocation(clientId: string, locationId: string, dto: UpdateLocationDto) {
    const updated = await this.tx(async (tx) => {
      const found = await tx.clientLocation.findFirst({ where: { id: locationId, clientId }, select: { id: true } });
      if (!found) throw resourceNotFound();
      return tx.clientLocation.update({
        where: { id: locationId },
        data: {
          ...(dto.locationType !== undefined && { locationType: dto.locationType }),
          ...(dto.address !== undefined && { address: this.enc(dto.address) }),
          ...(dto.zone !== undefined && { zone: dto.zone }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
          ...(dto.referenceNotes !== undefined && { referenceNotes: dto.referenceNotes }),
        },
      });
    });
    await this.audit.record({ entity: 'client_location', entityId: locationId, action: 'UPDATE', after: updated, redactKeys: CLIENT_REDACT });
    return updated;
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
