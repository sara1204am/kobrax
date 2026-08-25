import { Injectable } from '@nestjs/common';
import { gzipSync } from 'node:zlib';
import type { PrismaClient } from '@kobrax/database';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../../common/audit/audit.service';
import { safeDecrypt, clientDisplayName } from '../clients/clients.serializer';
import { toCsv } from './csv';

export interface ExportFile {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Exportar los datos de la cuenta: los cuatro CSV que pide el negocio (clientes, ubicaciones,
 * mora, agenda) más el backup completo. Ninguno pasa por `serializeClient` con `reveal: false`
 * —esto es un export, no una pantalla—, así que la PII sale en claro y cada llamada queda
 * auditada como `client/PII_REVEAL`, igual que «Mostrar» en la ficha.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private async logExport(kind: string): Promise<void> {
    await this.audit.record({ entity: `export:${kind}`, entityId: this.tenant.accountId, action: 'EXPORT' });
  }

  async clientsCsv(): Promise<ExportFile> {
    const clients = await this.tx((tx) =>
      tx.client.findMany({
        where: { accountId: this.tenant.accountId, deletedAt: null },
        include: { contacts: { where: { relationId: null, isPrimary: true }, take: 1 } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    await this.logExport('clients');

    const rows = clients.map((c) => ({
      id: c.id,
      nombre: clientDisplayName(c) ?? '',
      tipo: c.clientType,
      documento: safeDecrypt(this.crypto, c.nationalId) ?? '',
      contactoPrincipal: c.contacts[0] ? safeDecrypt(this.crypto, c.contacts[0].value) : '',
      estado: c.status,
      segmento: c.riskSegment ?? '',
      saldoTotal: Number(c.totalDebt),
      diasMoraMax: c.maxDaysPastDue,
      creditos: c.creditCount,
      creadoEl: c.createdAt,
    }));
    const csv = toCsv(rows, [
      'id',
      'nombre',
      'tipo',
      'documento',
      'contactoPrincipal',
      'estado',
      'segmento',
      'saldoTotal',
      'diasMoraMax',
      'creditos',
      'creadoEl',
    ]);
    return { filename: 'clientes.csv', content: Buffer.from(csv, 'utf-8'), contentType: 'text/csv; charset=utf-8' };
  }

  async locationsCsv(): Promise<ExportFile> {
    const locations = await this.tx((tx) =>
      tx.clientLocation.findMany({
        where: { accountId: this.tenant.accountId },
        include: { client: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    await this.logExport('locations');

    const rows = locations.map((l) => ({
      id: l.id,
      cliente: clientDisplayName(l.client) ?? '',
      tipo: l.locationType,
      direccion: safeDecrypt(this.crypto, l.address) ?? '',
      zona: l.zone ?? '',
      latitud: l.latitude != null ? Number(l.latitude) : '',
      longitud: l.longitude != null ? Number(l.longitude) : '',
      riesgo: l.riskLevel ?? '',
    }));
    const csv = toCsv(rows, ['id', 'cliente', 'tipo', 'direccion', 'zona', 'latitud', 'longitud', 'riesgo']);
    return { filename: 'ubicaciones.csv', content: Buffer.from(csv, 'utf-8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * Mora: un caso de cobranza por fila, con el cliente y el crédito que lo originan.
   *
   * ponytail: `asignado` queda como el id crudo del cobrador — resolver el nombre pide unir contra
   * `users`, que es una tabla global sin relación de Prisma con `collection_cases` (ref suave a
   * propósito, ver el schema). Se agrega si hace falta leer el nombre desde el CSV.
   */
  async casesCsv(): Promise<ExportFile> {
    const cases = await this.tx((tx) =>
      tx.collectionCase.findMany({
        where: { accountId: this.tenant.accountId, deletedAt: null },
        include: { client: true, credit: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    await this.logExport('cases');

    const rows = cases.map((c) => ({
      id: c.id,
      cliente: clientDisplayName(c.client) ?? '',
      credito: c.credit.code ?? c.creditId,
      estado: c.status,
      prioridad: c.priority,
      diasMora: c.credit.daysPastDue,
      saldo: Number(c.credit.outstandingBalance),
      moneda: c.credit.currency,
      asignado: c.assigneeId ?? '',
      ultimaGestion: c.lastActionAt ?? '',
      creadoEl: c.createdAt,
    }));
    const csv = toCsv(rows, [
      'id',
      'cliente',
      'credito',
      'estado',
      'prioridad',
      'diasMora',
      'saldo',
      'moneda',
      'asignado',
      'ultimaGestion',
      'creadoEl',
    ]);
    return { filename: 'mora.csv', content: Buffer.from(csv, 'utf-8'), contentType: 'text/csv; charset=utf-8' };
  }

  /** `AgendaItem.clientId` es ref suave (sin relación de Prisma) — se resuelve con una segunda consulta. */
  async agendaCsv(): Promise<ExportFile> {
    const { items, clientById } = await this.tx(async (tx) => {
      const items = await tx.agendaItem.findMany({
        where: { accountId: this.tenant.accountId, deletedAt: null },
        orderBy: { scheduledDate: 'asc' },
      });
      const clients = await tx.client.findMany({ where: { id: { in: [...new Set(items.map((a) => a.clientId))] } } });
      return { items, clientById: new Map(clients.map((c) => [c.id, c])) };
    });
    await this.logExport('agenda');

    const rows = items.map((a) => ({
      id: a.id,
      cliente: clientDisplayName(clientById.get(a.clientId) ?? {}) ?? '',
      tipo: a.type,
      estado: a.status,
      fecha: a.scheduledDate,
      hora: a.scheduledTime ?? '',
      asignado: a.assigneeId,
      observaciones: a.observations ?? '',
    }));
    const csv = toCsv(rows, ['id', 'cliente', 'tipo', 'estado', 'fecha', 'hora', 'asignado', 'observaciones']);
    return { filename: 'agenda.csv', content: Buffer.from(csv, 'utf-8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * El backup de la cuenta: un único JSON con todo lo operativo, comprimido. A diferencia de los
   * CSV de arriba —pensados para abrirse en una planilla— esto es una copia de seguridad: trae
   * los IDs y los `metadata` crudos, no sólo las columnas que se leen a simple vista.
   *
   * ponytail: cubre clientes (con sus contactos/ubicaciones/relaciones/garantías/adjuntos),
   * créditos, casos (con su bitácora), pagos y agenda — lo que hace a «la cartera» de la cuenta.
   * Quedan afuera rutas, catálogos y dashboards (configuración operativa, no datos de negocio);
   * se suman el día que alguien los necesite en el backup.
   */
  async fullBackup(): Promise<ExportFile> {
    const accountId = this.tenant.accountId;
    const data = await this.tx(async (tx) => {
      const [clients, credits, cases, payments, agendaItems] = await Promise.all([
        tx.client.findMany({
          where: { accountId, deletedAt: null },
          include: {
            contacts: true,
            locations: true,
            relations: { include: { contacts: true, locations: true } },
            collaterals: true,
            attachments: true,
          },
        }),
        tx.credit.findMany({ where: { accountId, deletedAt: null } }),
        tx.collectionCase.findMany({ where: { accountId, deletedAt: null }, include: { activities: true } }),
        tx.payment.findMany({ where: { accountId } }),
        tx.agendaItem.findMany({ where: { accountId, deletedAt: null } }),
      ]);
      return { clients, credits, cases, payments, agendaItems };
    });
    await this.logExport('backup');

    const decrypted = {
      ...data,
      clients: data.clients.map((c) => ({
        ...c,
        nationalId: safeDecrypt(this.crypto, c.nationalId),
        taxId: safeDecrypt(this.crypto, c.taxId),
        contacts: c.contacts.map((ct) => ({ ...ct, value: safeDecrypt(this.crypto, ct.value) })),
        locations: c.locations.map((l) => ({ ...l, address: safeDecrypt(this.crypto, l.address) })),
        relations: c.relations.map((r) => ({
          ...r,
          contacts: r.contacts.map((ct) => ({ ...ct, value: safeDecrypt(this.crypto, ct.value) })),
          locations: r.locations.map((l) => ({ ...l, address: safeDecrypt(this.crypto, l.address) })),
        })),
      })),
    };

    const json = JSON.stringify({ accountId, generatedAt: new Date().toISOString(), ...decrypted });
    return {
      filename: 'backup-cuenta.json.gz',
      content: gzipSync(Buffer.from(json, 'utf-8')),
      contentType: 'application/gzip',
    };
  }
}
