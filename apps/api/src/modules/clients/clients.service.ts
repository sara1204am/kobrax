import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
// `Prisma` entra como valor y no sólo como tipo: la cartera arma su SQL con `Prisma.sql` (§W3).
import { ClientType, Prisma } from '@prisma/client';
import { Permission, resolvePagination, searchTerms, type ApiResponse, type ClientTimelineEntry, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { nameTerms } from '../../common/name-search';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BlindIndexService } from '../../common/crypto/blind-index.service';
import { AuditService } from '../../common/audit/audit.service';
import { serializeClient, type PortfolioClient, type PortfolioTotals } from './clients.serializer';
import {
  CreateAttachmentDto,
  CreateClientDto,
  CreateCollateralDto,
  CreateContactDto,
  CreateLocationDto,
  UpdateAttachmentDto,
  UpdateCollateralDto,
  UpdateLocationDto,
  UpdateRelationDto,
  CreateRelationDto,
  ListClientsQueryDto,
  TimelineQueryDto,
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

/** Una fila cruda de la bitácora, antes de volverse `ClientTimelineEntry`. */
interface TimelineRow {
  kind: ClientTimelineEntry['kind'];
  id: string;
  at: Date;
  code: string;
  status: string | null;
  amount: number | null;
  currency: string | null;
  notes: string | null;
  credit_id: string | null;
  case_id: string | null;
  user_id: string | null;
}

/*
 * Acá vivía un techo para el conteo de la cartera («10.000+»), porque contar exacto obligaba a
 * agregar el tenant entero. Con los agregados denormalizados el `COUNT(*)` es un scan de `clients`:
 * 18 ms sin filtros y 72 ms con el peor de ellos, sobre 100.000 personas. El número exacto salió
 * más barato que la complejidad de esconderlo.
 */

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
        await this.linkGuarantor(tx, client.id, rel.id, r.creditIds);
      }
      /*
       * Las garantías van al final del alta, después de las relaciones, por una razón práctica: en un
       * alta el crédito **todavía no existe** —se carga después, desde la ficha—, así que `creditIds`
       * casi siempre llega vacío acá y el vínculo se arma al editar. La garantía igual se guarda: el
       * bien es del cliente, no del crédito.
       */
      for (const g of dto.collaterals ?? []) {
        const row = await tx.collateral.create({
          data: { accountId: acc, clientId: client.id, type: g.type, description: g.description, estimatedValue: g.estimatedValue, currency: g.currency, photoUrls: (g.photoUrls ?? []) as Prisma.InputJsonValue },
        });
        audits.push({ kind: 'collateral', id: row.id, after: row });
        await this.linkCollateral(tx, client.id, row.id, g.creditIds);
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
        // El documento matchea la búsqueda ENTERA por blind index: está cifrado, o es exacto o nada.
        ...(docHash ? [{ nationalIdHash: docHash }] : []),
        { AND: nameTerms(query.q) },
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
   *
   * 🔴 **Los tres números NO se calculan acá: se leen.** `total_debt`, `max_days_past_due` y
   * `credit_count` son columnas de `clients` que mantiene el trigger `credits_totals_*` (migración
   * `20260814210000`). Por eso esta consulta no tiene `JOIN`, ni `GROUP BY`, ni `HAVING`: es un
   * `WHERE` y un `ORDER BY` que caen en índice.
   *
   * Antes agregaba el tenant entero en cada request, porque ordenar por un agregado obliga a
   * calcular todos los grupos antes de saber cuáles son los 50 primeros. Con 100.000 personas y
   * 300.000 créditos (`prisma/seed-perf.sql`) eso medía **768 ms** la primera página; ahora,
   * **menos de 1 ms**.
   *
   * Sigue en SQL crudo por una sola razón: el orden por nombre es
   * `COALESCE(business_name, last_name, first_name)`, y eso Prisma no lo sabe ordenar.
   */
  private async listPortfolio(
    query: ListClientsQueryDto,
    page: number,
    limit: number,
    skip: number,
  ): Promise<ApiResponse<PortfolioClient[]>> {
    const where = this.portfolioWhere(query);
    const página = Prisma.sql`
      SELECT c.id,
             c.total_debt::float8  AS total_debt,
             c.max_days_past_due   AS max_days_past_due,
             c.credit_count        AS credit_count
      FROM clients c
      WHERE ${where}
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
    /*
     * 🔴 **El cobrador se filtra con `EXISTS`, no con un `JOIN`.**
     *
     * Vive en `collection_cases`, y un cliente puede tener varios casos: con un join, su saldo se
     * sumaría una vez por caso y la deuda de la fila daría de más. Es el mismo defecto que ya se
     * pagó en analytics. `EXISTS` sólo pregunta «¿alguno?» y no multiplica filas.
     */
    if (query.collectorId) {
      conds.push(Prisma.sql`EXISTS (
        SELECT 1 FROM collection_cases k
        WHERE k.client_id = c.id AND k.deleted_at IS NULL AND k.assignee_id = ${query.collectorId})`);
    }
    /*
     * La sucursal es del CRÉDITO, así que también va con `EXISTS`: «tiene algún crédito vivo de esta
     * sucursal». Con un `JOIN`, el cliente con dos créditos de la misma sucursal aparecería dos
     * veces en la lista.
     */
    if (query.branchId) {
      conds.push(Prisma.sql`EXISTS (
        SELECT 1 FROM credits k
        WHERE k.client_id = c.id AND k.deleted_at IS NULL AND k.branch_id = ${query.branchId})`);
    }
    /*
     * 🔴 **Los filtros de agregado son un `WHERE` común, no un `HAVING`.**
     *
     * Y siguen significando lo mismo que antes: «mora > 90» es sobre la PERSONA —su peor mora—, no
     * «tiene algún crédito con más de 90». Quien tiene uno de 400 días y otro al día entra; quien
     * tiene tres de 30, no. La diferencia es que ahora la columna ya está calculada, así que la
     * condición cae en el índice en vez de obligar a agrupar la cartera entera.
     */
    if (query.debtMin != null) conds.push(Prisma.sql`c.total_debt >= ${query.debtMin}`);
    if (query.debtMax != null) conds.push(Prisma.sql`c.total_debt <= ${query.debtMax}`);
    if (query.dpdMin != null) conds.push(Prisma.sql`c.max_days_past_due >= ${query.dpdMin}`);
    if (query.dpdMax != null) conds.push(Prisma.sql`c.max_days_past_due <= ${query.dpdMax}`);
    if (query.creditsMin != null) conds.push(Prisma.sql`c.credit_count >= ${query.creditsMin}`);
    if (query.creditsMax != null) conds.push(Prisma.sql`c.credit_count <= ${query.creditsMax}`);
    if (query.q) {
      const docHash = this.blind.hash(query.q);
      /*
       * 🔴 **Palabra por palabra, y todas tienen que estar.** Con la frase entera, «Teresa Mama» no
       * encontraba a «Teresa Mamani Padilla»: el espacio cae justo entre el nombre y el apellido, y
       * ningún campo contiene la frase. Cada palabra puede matchear en un campo distinto.
       *
       * Sigue parametrizado: los `%…%` los arma `Prisma.sql`, nunca se concatena en el texto.
       */
      const porNombre = Prisma.join(
        searchTerms(query.q).map((term) => {
          const like = `%${term}%`;
          return Prisma.sql`(c.first_name ILIKE ${like} OR c.last_name ILIKE ${like} OR c.business_name ILIKE ${like})`;
        }),
        ' AND ',
      );
      // El documento está cifrado: matchea exacto por blind index o no matchea.
      conds.push(docHash ? Prisma.sql`(c.national_id_hash = ${docHash} OR (${porNombre}))` : Prisma.sql`(${porNombre})`);
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
        return Prisma.sql`c.total_debt ${dir}, c.id`;
      case 'name':
        return Prisma.sql`COALESCE(c.business_name, c.last_name, c.first_name) ${dir}, c.id`;
      case 'status':
        return Prisma.sql`c.client_status ${dir}, c.id`;
      case 'createdAt':
        return Prisma.sql`c.created_at ${dir}, c.id`;
      case 'dpd':
      default:
        // La mora manda y la deuda desempata: entre dos que deben hace los mismos días, primero el
        // que debe más. Es el orden con el que abre la pantalla, y el que tiene índice propio.
        return Prisma.sql`c.max_days_past_due ${dir}, c.total_debt ${dir}, c.id`;
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
          // Cada contacto/relación trae los suyos, y a qué créditos respalda.
          relations: { include: { contacts: true, locations: true, credits: { select: { creditId: true } } } },
          collaterals: { include: { credits: { select: { creditId: true } } } },
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

  /**
   * La bitácora del cliente: **todo lo que se hizo con esta persona**, de todos sus créditos.
   *
   * 🔴 **Un `UNION ALL`, no tres listas mezcladas en Node.** Las tres fuentes tienen su propia
   * paginación: traer «las 20 últimas de cada una» y ordenarlas después da una primera página que
   * puede estar bien de casualidad, y una segunda que directamente miente —falta lo que quedó
   * afuera del corte de cada fuente—. Ordenar y paginar es trabajo de la base.
   *
   * 🔴 **Cada fuente entra sólo si quien mira puede verla.** La bitácora cruza tres dominios con
   * tres permisos: sin esta guarda, la ficha del cliente se volvería la puerta de atrás para leer
   * pagos sin `payment:read`. Lo que no se puede ver no aparece —y no se avisa que falta, porque
   * eso también es información—.
   *
   * Las fechas: el pago vale por `payment_date` (cuándo se cobró, no cuándo se cargó), el agendado
   * por cuándo se actualizó (es cuando se ejecutó o se canceló) y la gestión por su alta.
   */
  async timeline(clientId: string, query: TimelineQueryDto): Promise<ApiResponse<ClientTimelineEntry[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const partes: Prisma.Sql[] = [];

    if (this.tenant.can(Permission.PAYMENT_READ)) {
      partes.push(Prisma.sql`
        SELECT 'PAYMENT' AS kind, p.id, p.payment_date AS at, p.method::text AS code, NULL AS status,
               p.amount::float8 AS amount, cr.currency AS currency, NULL AS notes,
               p.credit_id AS credit_id, p.case_id AS case_id, p.registered_by AS user_id
        FROM payments p
        JOIN credits cr ON cr.id = p.credit_id
        WHERE cr.client_id = ${clientId}`);
    }
    if (this.tenant.can(Permission.AGENDA_READ)) {
      partes.push(Prisma.sql`
        SELECT 'AGENDA' AS kind, a.id, a.updated_at AS at, a.type::text AS code, a.status::text AS status,
               NULL AS amount, NULL AS currency, a.observations AS notes,
               a.credit_id AS credit_id, a.case_id AS case_id, a.assignee_id AS user_id
        FROM agenda_items a
        WHERE a.client_id = ${clientId} AND a.deleted_at IS NULL`);
    }
    if (this.tenant.can(Permission.CASE_READ)) {
      partes.push(Prisma.sql`
        SELECT 'ACTIVITY' AS kind, ac.id, ac.created_at AS at, ac.type::text AS code, ac.result AS status,
               NULL AS amount, NULL AS currency, ac.notes AS notes,
               NULL AS credit_id, ac.case_id AS case_id, ac.user_id AS user_id
        FROM case_activities ac
        JOIN collection_cases k ON k.id = ac.case_id
        WHERE k.client_id = ${clientId}`);
    }
    // Sin ningún permiso no hay consulta que hacer: `UNION ALL` de cero partes no es SQL válido.
    if (partes.length === 0) return ResponseDto.paginated([], 0, page, limit);

    const union = Prisma.join(partes, ' UNION ALL ');
    const [rows, totals] = await this.tx((tx) =>
      Promise.all([
        tx.$queryRaw<TimelineRow[]>(
          // El desempate por `id` es el mismo cuidado que en la cartera: dos gestiones del mismo
          // segundo se intercambiarían entre páginas, y con `LIMIT/OFFSET` eso repite o saltea.
          Prisma.sql`SELECT * FROM (${union}) t ORDER BY t.at DESC, t.id LIMIT ${limit} OFFSET ${skip}`,
        ),
        tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS total FROM (${union}) t`),
      ]),
    );

    const data = rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      at: r.at.toISOString(),
      code: r.code,
      status: r.status ?? undefined,
      amount: r.amount ?? undefined,
      currency: r.currency ?? undefined,
      notes: r.notes ?? undefined,
      creditId: r.credit_id ?? undefined,
      caseId: r.case_id ?? undefined,
      userId: r.user_id ?? undefined,
    }));
    return ResponseDto.paginated(data, totals[0]?.total ?? 0, page, limit);
  }

  async update(id: string, dto: UpdateClientDto): Promise<ReturnType<typeof serializeClient>> {
    const { before, after } = await this.tx(async (tx) => {
      const prev = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!prev) throw resourceNotFound();

      /*
       * 🔴 **La identidad se valida contra lo que QUEDA, no contra lo que llegó.** El PATCH manda
       * sólo lo que cambió: pasar a `COMPANY` sin tocar el nombre, o vaciar el apellido de una
       * persona, dejaba un cliente que el alta nunca habría aceptado. Se mezcla con lo guardado y
       * se aplica el mismo corte que en `create`.
       */
      const clientType = dto.clientType ?? prev.clientType;
      this.assertIdentity(
        clientType,
        dto.firstName ?? prev.firstName ?? undefined,
        dto.lastName ?? prev.lastName ?? undefined,
        dto.businessName ?? prev.businessName ?? undefined,
      );

      const data: Prisma.ClientUpdateInput = {
        clientType: dto.clientType,
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
      // El vínculo con los créditos va en la MISMA transacción que el resto del garante: si el
      // segundo paso falla, no queda un garante renombrado que además perdió a quién respaldaba.
      await this.linkGuarantor(tx, clientId, relationId, dto.creditIds);
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
          ...(dto.photoUrls !== undefined && { photoUrls: dto.photoUrls as Prisma.InputJsonValue }),
        },
      });
    });
    await this.audit.record({ entity: 'client_location', entityId: locationId, action: 'UPDATE', after: updated, redactKeys: CLIENT_REDACT });
    return updated;
  }

  async addRelation(clientId: string, dto: CreateRelationDto) {
    return this.subCreate(clientId, 'relation', async (tx) => {
      const rel = await tx.clientRelation.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          relatedName: dto.relatedName,
          relationshipType: dto.relationshipType,
          gender: dto.gender,
          isContactable: dto.isContactable ?? true,
          notes: dto.notes,
        },
      });
      await this.linkGuarantor(tx, clientId, rel.id, dto.creditIds);
      return rel;
    });
  }

  // ── Garantías (el bien, no la persona) ──────────────────────────────────────
  /**
   * 🔴 **Los créditos tienen que ser de ESTE cliente.**
   *
   * Sin esto, mandar el id de un crédito ajeno ata la garantía —o el garante— a la deuda de otra
   * persona. Es el mismo cuidado que `assertRelationOf`, y acá pesa más: el vínculo es lo que hace
   * que alguien vaya a ejecutar un bien.
   *
   * Devuelve la lista tal como quedó. `undefined` significa «no lo toques»; `[]`, «sacá todos».
   */
  private async assertCreditsOf(tx: PrismaClient, clientId: string, creditIds: string[]): Promise<void> {
    if (creditIds.length === 0) return;
    const found = await tx.credit.findMany({
      where: { id: { in: creditIds }, clientId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(creditIds).size) throw resourceNotFound();
  }

  /**
   * Deja el vínculo garante ↔ créditos **igual a la lista que llegó**: borrar y volver a escribir.
   *
   * Es el mismo trato que el layout del tablero (W8): mandar diferencias por vínculo obligaría a
   * resolver qué se agregó y qué se quitó en el cliente, y lo que la pantalla sabe es el estado
   * final. `undefined` es «no vino el campo» y no toca nada.
   */
  private async linkGuarantor(tx: PrismaClient, clientId: string, relationId: string, creditIds?: string[]): Promise<void> {
    if (!creditIds) return;
    await this.assertCreditsOf(tx, clientId, creditIds);
    await tx.creditGuarantor.deleteMany({ where: { relationId } });
    if (creditIds.length > 0) {
      await tx.creditGuarantor.createMany({
        data: creditIds.map((creditId) => ({ accountId: this.tenant.accountId, relationId, creditId })),
        skipDuplicates: true,
      });
    }
  }

  /** Ídem `linkGuarantor`, del lado de la garantía. */
  private async linkCollateral(tx: PrismaClient, clientId: string, collateralId: string, creditIds?: string[]): Promise<void> {
    if (!creditIds) return;
    await this.assertCreditsOf(tx, clientId, creditIds);
    await tx.collateralCredit.deleteMany({ where: { collateralId } });
    if (creditIds.length > 0) {
      await tx.collateralCredit.createMany({
        data: creditIds.map((creditId) => ({ accountId: this.tenant.accountId, collateralId, creditId })),
        skipDuplicates: true,
      });
    }
  }

  async addCollateral(clientId: string, dto: CreateCollateralDto) {
    return this.subCreate(clientId, 'collateral', async (tx) => {
      const row = await tx.collateral.create({
        data: {
          accountId: this.tenant.accountId,
          clientId,
          type: dto.type,
          description: dto.description,
          estimatedValue: dto.estimatedValue,
          currency: dto.currency,
          photoUrls: (dto.photoUrls ?? []) as Prisma.InputJsonValue,
        },
      });
      await this.linkCollateral(tx, clientId, row.id, dto.creditIds);
      return row;
    });
  }

  async updateCollateral(clientId: string, collateralId: string, dto: UpdateCollateralDto) {
    const updated = await this.tx(async (tx) => {
      const found = await tx.collateral.findFirst({ where: { id: collateralId, clientId }, select: { id: true } });
      if (!found) throw resourceNotFound();
      await this.linkCollateral(tx, clientId, collateralId, dto.creditIds);
      return tx.collateral.update({
        where: { id: collateralId },
        data: {
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.estimatedValue !== undefined && { estimatedValue: dto.estimatedValue }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.photoUrls !== undefined && { photoUrls: dto.photoUrls as Prisma.InputJsonValue }),
        },
      });
    });
    await this.audit.record({ entity: 'client_collateral', entityId: collateralId, action: 'UPDATE', after: updated, redactKeys: CLIENT_REDACT });
    return updated;
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

  /** Reclasificar un adjunto. El archivo no se toca: su hash es la prueba de que no cambió. */
  async updateAttachment(clientId: string, attachmentId: string, dto: UpdateAttachmentDto) {
    const updated = await this.tx(async (tx) => {
      const found = await tx.clientAttachment.findFirst({ where: { id: attachmentId, clientId }, select: { id: true } });
      if (!found) throw resourceNotFound();
      return tx.clientAttachment.update({ where: { id: attachmentId }, data: { fileType: dto.fileType } });
    });
    await this.audit.record({ entity: 'client_attachment', entityId: attachmentId, action: 'UPDATE', after: updated, redactKeys: CLIENT_REDACT });
    return updated;
  }

  /** Baja de un sub-recurso (contact/location/relation/collateral/attachment). Scoped por cliente + RLS. */
  async removeSub(
    clientId: string,
    kind: 'contact' | 'location' | 'relation' | 'collateral' | 'attachment',
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
          // Sus vínculos con créditos se van con él: la FK es `ON DELETE CASCADE`.
          return tx.clientRelation.deleteMany({ where });
        case 'collateral':
          return tx.collateral.deleteMany({ where });
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
