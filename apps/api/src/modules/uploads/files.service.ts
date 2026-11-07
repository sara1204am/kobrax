import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { FileOwnerEntity, FileStatus, Prisma, type File as FileRow, type FileOwner } from '@prisma/client';
import { Permission } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { moraScopeOf, seesWholeAccount, visibleClientIdsSql, visibleCreditIdsSql } from '../mora/mora-query';
import type { StoredFile } from './uploads.service';

/** Vida de un enlace firmado. Corta a propósito: sirve para abrir una imagen en una pestaña o compartirla un momento, no para guardarla. */
export const FILE_LINK_TTL_MS = 5 * 60 * 1000;

/** Los dueños cuya lectura queda auditada: documentos, evidencias de campo y archivos de importaciones (las fotos de las listas no). */
const AUDITABLE: ReadonlySet<FileOwnerEntity> = new Set([FileOwnerEntity.CLIENT_ATTACHMENT, FileOwnerEntity.FIELD_EVIDENCE, FileOwnerEntity.IMPORT_RUN]);

export interface FileAccess {
  file: FileRow;
  owners: FileOwner[];
  allowed: boolean;
  /** ¿La lectura de este archivo se audita? */
  auditable: boolean;
}

/**
 * F14 · F4 (ADR-F14-07): el registro de archivos y su política de lectura.
 *
 * Quién ES dueño de un archivo lo mantienen los triggers de la base (`files_sync_owner`); acá sólo se LEE el registro, se decide quién
 * puede abrirlo y se firman los enlaces temporales. La regla de lectura mira de qué cuelga el archivo y si la persona ve ese algo:
 *
 *   adjunto / ubicación / relación / garantía de un cliente → ve al cliente (alcance) y tiene `client:contact:read`
 *   comprobante de un pago          → ve el crédito del pago (alcance) y tiene `payment:read`
 *   evidencia de campo              → es su visita o ve el crédito, y tiene `client:contact:read`
 *   foto / QR de un perfil          → la persona es miembro de esta cuenta
 *   logo de la cuenta               → cualquier miembro
 *   archivo de una importación      → `client:import` y `client:pii:read`
 *   sin dueño todavía (recién subido) → sólo quien lo subió
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  private tx<T>(fn: (tx: import('@prisma/client').PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Registra una subida recién guardada en disco (PENDING, hasta que algo la ate). Idempotente: el nombre es el hash del contenido. */
  async registerUpload(stored: StoredFile): Promise<string> {
    const storageKey = stored.url.split('/').pop()!;
    const accountId = this.tenant.accountId;
    const row = await this.tx((tx) =>
      tx.file.upsert({
        where: { accountId_storageKey: { accountId, storageKey } },
        create: { accountId, storageKey, sha256: stored.hash, mime: stored.mimeType, size: stored.size, status: FileStatus.PENDING, uploadedBy: this.tenant.userId },
        // Subir de nuevo lo que quedó huérfano lo revive; lo que ya está atado no se toca.
        update: { deletedAt: null },
      }),
    );
    if (row.status === FileStatus.ORPHAN) {
      await this.tx((tx) => tx.file.update({ where: { id: row.id }, data: { status: FileStatus.PENDING, orphanedAt: null, uploadedBy: this.tenant.userId, size: stored.size } }));
    }
    return row.id;
  }

  /** El archivo por la ruta con la que se guarda (`<hash>.<ext>`) dentro de la cuenta en sesión. */
  findByStorageKey(storageKey: string): Promise<FileRow | null> {
    const accountId = this.tenant.accountId;
    return this.tx((tx) => tx.file.findFirst({ where: { accountId, storageKey, deletedAt: null } }));
  }

  findById(id: string): Promise<FileRow | null> {
    return this.tx((tx) => tx.file.findFirst({ where: { id, deletedAt: null } }));
  }

  /** ¿Puede esta persona abrir el archivo? Con la lista de dueños, para que la lectura se audite según de qué cuelga. */
  async accessFor(file: FileRow): Promise<FileAccess> {
    const owners = await this.tx((tx) => tx.fileOwner.findMany({ where: { fileId: file.id } }));
    const auditable = owners.some((o) => AUDITABLE.has(o.ownerEntity));
    if (owners.length === 0) {
      // Recién subido y todavía sin atar: sólo quien lo subió.
      return { file, owners, auditable: false, allowed: file.uploadedBy != null && file.uploadedBy === this.tenant.userId };
    }
    const byEntity = new Map<FileOwnerEntity, string[]>();
    for (const o of owners) byEntity.set(o.ownerEntity, [...(byEntity.get(o.ownerEntity) ?? []), o.ownerId]);
    for (const [entity, ids] of byEntity) {
      if (await this.ownerAllows(entity, ids)) return { file, owners, auditable, allowed: true };
    }
    return { file, owners, auditable, allowed: false };
  }

  private async ownerAllows(entity: FileOwnerEntity, ids: string[]): Promise<boolean> {
    const can = (p: Permission) => this.tenant.can(p);
    const accountId = this.tenant.accountId;
    const scope = moraScopeOf(this.tenant);
    const whole = seesWholeAccount(scope);
    const any = async (sql: Prisma.Sql) => (await this.tx((tx) => tx.$queryRaw<{ ok: number }[]>(sql))).length > 0;
    // `TRUE` si ve toda la cuenta; si no, la subconsulta de visibilidad (la misma regla que Mora, Clientes y Pagos).
    const clientVisible = (col: string) => (whole ? Prisma.sql`TRUE` : Prisma.sql`${Prisma.raw(col)} IN (${visibleClientIdsSql(scope)})`);
    const creditVisible = (col: string) => (whole ? Prisma.sql`TRUE` : Prisma.sql`${Prisma.raw(col)} IN (${visibleCreditIdsSql(scope)})`);

    switch (entity) {
      case FileOwnerEntity.CLIENT_ATTACHMENT:
        return can(Permission.CLIENT_CONTACT_READ) && any(Prisma.sql`SELECT 1 AS ok FROM client_attachments x WHERE x.account_id = ${accountId} AND x.id = ANY(${ids}) AND ${clientVisible('x.client_id')} LIMIT 1`);
      case FileOwnerEntity.CLIENT_LOCATION:
        return can(Permission.CLIENT_CONTACT_READ) && any(Prisma.sql`SELECT 1 AS ok FROM client_locations x WHERE x.account_id = ${accountId} AND x.id = ANY(${ids}) AND ${clientVisible('x.client_id')} LIMIT 1`);
      case FileOwnerEntity.CLIENT_RELATION:
        return can(Permission.CLIENT_CONTACT_READ) && any(Prisma.sql`SELECT 1 AS ok FROM client_relations x WHERE x.account_id = ${accountId} AND x.id = ANY(${ids}) AND ${clientVisible('x.client_id')} LIMIT 1`);
      case FileOwnerEntity.COLLATERAL:
        return can(Permission.CLIENT_CONTACT_READ) && any(Prisma.sql`SELECT 1 AS ok FROM collaterals x WHERE x.account_id = ${accountId} AND x.id = ANY(${ids}) AND ${clientVisible('x.client_id')} LIMIT 1`);
      case FileOwnerEntity.PAYMENT_RECEIPT:
        return can(Permission.PAYMENT_READ) && any(Prisma.sql`SELECT 1 AS ok FROM payments x WHERE x.account_id = ${accountId} AND x.id = ANY(${ids}) AND ${creditVisible('x.credit_id')} LIMIT 1`);
      case FileOwnerEntity.FIELD_EVIDENCE: {
        if (!can(Permission.CLIENT_CONTACT_READ)) return false;
        const me = this.tenant.userId ?? '';
        return any(
          Prisma.sql`SELECT 1 AS ok FROM field_evidences e JOIN field_visits v ON v.id = e.visit_id
                     WHERE e.account_id = ${accountId} AND e.id = ANY(${ids}) AND (v.collector_id = ${me} OR ${creditVisible('v.credit_id')}) LIMIT 1`,
        );
      }
      case FileOwnerEntity.PROFILE_PHOTO:
      case FileOwnerEntity.PROFILE_QR:
        return any(Prisma.sql`SELECT 1 AS ok FROM user_accounts ua WHERE ua.account_id = ${accountId} AND ua.user_id = ANY(${ids}) LIMIT 1`);
      case FileOwnerEntity.ACCOUNT_LOGO:
        return ids.includes(accountId);
      case FileOwnerEntity.IMPORT_RUN:
        return can(Permission.CLIENT_IMPORT) && can(Permission.CLIENT_PII_READ);
      default:
        return false;
    }
  }

  /** Audita la lectura de un archivo de los que se auditan (documentos y evidencias). Sin valores: sólo qué archivo y de qué cuelga. */
  async auditRead(access: FileAccess, via: 'api' | 'link'): Promise<void> {
    if (!access.auditable) return;
    await this.audit.record({
      entity: 'file',
      entityId: access.file.id,
      action: 'FILE_READ',
      after: { owners: [...new Set(access.owners.map((o) => o.ownerEntity))], via, channel: this.tenant.get?.()?.channel ?? 'api' },
    });
  }

  // ── Enlaces firmados ────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private sign(accountId: string, fileId: string, exp: number): string {
    return createHmac('sha256', this.config.fileLinkSecret).update(`${accountId}.${fileId}.${exp}`).digest('base64url');
  }

  /**
   * Un enlace temporal a un archivo que la persona YA puede leer. La firma liga cuenta, archivo y vencimiento. El rastro de auditoría queda
   * AL CREAR el enlace (`FILE_LINK`: quién lo pidió, de qué archivo, hasta cuándo); la lectura posterior por el enlace es anónima por diseño
   * (no hay sesión) y no se audita por separado: quien tiene el enlace tiene lo que le dio quien lo pidió.
   */
  async createLink(access: FileAccess, now = Date.now()): Promise<{ url: string; expiresAt: string }> {
    const exp = now + FILE_LINK_TTL_MS;
    const accountId = this.tenant.accountId;
    const sig = this.sign(accountId, access.file.id, exp);
    await this.audit.record({ entity: 'file', entityId: access.file.id, action: 'FILE_LINK', after: { expiresAt: new Date(exp).toISOString() } });
    return { url: `/api/files/${access.file.id}/raw?acc=${encodeURIComponent(accountId)}&exp=${exp}&sig=${sig}`, expiresAt: new Date(exp).toISOString() };
  }

  /** ¿La firma es válida y no venció? Comparación en tiempo constante. */
  verifyLink(accountId: string, fileId: string, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isFinite(exp) || exp < now) return false;
    const expected = Buffer.from(this.sign(accountId, fileId, exp));
    const given = Buffer.from(sig ?? '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Lee el archivo de una cuenta SIN sesión (sólo se usa tras verificar la firma). */
  findForLink(accountId: string, fileId: string): Promise<FileRow | null> {
    return this.prisma.withSystemTenant(accountId, (tx) => tx.file.findFirst({ where: { id: fileId, accountId, deletedAt: null } }));
  }
}
