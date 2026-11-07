import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { moraScopeOf, seesWholeAccount, visibleClientIdsSql, visibleCreditIdsSql } from '../mora/mora-query';
import { FilesService } from './files.service';

/** Nombre de archivo válido: `<sha256>.<ext>`. Es lo único que llega a `GET /uploads/:name`. */
export const UPLOAD_NAME = /^[0-9a-f]{64}\.(jpg|png|webp)$/;

/**
 * F14 · F1 (R-06, mínimo; interino hasta la tabla `files` de F4): ¿esta persona puede LEER este archivo?
 *
 * Antes cualquier sesión del tenant leía cualquier archivo con sólo conocer el nombre. Ahora el archivo tiene que colgar de algo que
 * la persona ve —el adjunto o la ubicación de un cliente visible, el comprobante de un pago visible, la evidencia de una visita
 * suya o de un crédito visible—, ser una foto/QR de perfil de un miembro de la cuenta, o haberlo subido ella misma (aún sin atar).
 * Con alcance sobre toda la cuenta (`data:scope:all`) se conserva el comportamiento de siempre.
 */
@Injectable()
export class UploadAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    /** F14 · F4: el registro de archivos y su política. Sin él (specs anteriores) rige sólo la regla de abajo. */
    private readonly files?: FilesService,
  ) {}

  async canRead(name: string): Promise<boolean> {
    if (!UPLOAD_NAME.test(name)) return false;
    // F14 · F4: si el archivo está en el registro y tiene dueños, la política de `FilesService` es la que manda (VIEWER no abre adjuntos de
    // clientes aunque vea toda la cuenta). La regla de abajo queda como respaldo para lo anterior al registro y para lo recién subido.
    if (this.files) {
      const file = await this.files.findByStorageKey(name);
      if (file) {
        const access = await this.files.accessFor(file);
        if (access.owners.length > 0) {
          if (access.allowed) await this.files.auditRead(access, 'api');
          return access.allowed;
        }
        if (access.allowed) return true; // lo subió esta persona y todavía no lo ató
      }
    }
    const scope = moraScopeOf(this.tenant);
    if (seesWholeAccount(scope)) return true;

    const accountId = this.tenant.accountId;
    const me = this.tenant.userId ?? '';
    const url = `/api/uploads/${name}`;
    const hash = name.slice(0, 64);
    const clients = visibleClientIdsSql(scope);
    const credits = visibleCreditIdsSql(scope);

    const rows = await this.prisma.withTenant(accountId, (tx) =>
      tx.$queryRaw<{ ok: number }[]>(Prisma.sql`
        SELECT 1 AS ok FROM (
          SELECT 1 FROM profiles p JOIN user_accounts ua ON ua.user_id = p.user_id AND ua.account_id = ${accountId}
            WHERE p.photo_url = ${url} OR p.payment_qr_url = ${url}
          UNION ALL
          SELECT 1 FROM client_attachments a WHERE a.account_id = ${accountId} AND a.file_url = ${url} AND a.client_id IN (${clients})
          UNION ALL
          SELECT 1 FROM client_locations l WHERE l.account_id = ${accountId} AND l.photo_urls::text LIKE ${'%' + url + '%'} AND l.client_id IN (${clients})
          UNION ALL
          SELECT 1 FROM collaterals c WHERE c.account_id = ${accountId} AND c.photo_urls::text LIKE ${'%' + url + '%'} AND c.client_id IN (${clients})
          UNION ALL
          SELECT 1 FROM payments pa WHERE pa.account_id = ${accountId} AND pa.receipt_url = ${url} AND pa.credit_id IN (${credits})
          UNION ALL
          SELECT 1 FROM field_evidences e JOIN field_visits v ON v.id = e.visit_id
            WHERE e.account_id = ${accountId} AND e.file_url = ${url} AND (v.collector_id = ${me} OR v.credit_id IN (${credits}))
          UNION ALL
          SELECT 1 FROM audit_logs al WHERE al.account_id = ${accountId} AND al.entity = 'upload' AND al.entity_id = ${hash} AND al.user_id = ${me}
        ) q LIMIT 1`),
    );
    return rows.length > 0;
  }
}
