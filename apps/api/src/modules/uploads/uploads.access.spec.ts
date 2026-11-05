import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { UploadAccessService } from './upload-access.service';
import { AuthzGuard } from '../auth/guards/authz.guard';
import { RolesAny } from '../auth/decorators/roles.decorator';

const NAME = 'a'.repeat(64) + '.jpg';

function make(opts: { can?: string[]; rows?: number }) {
  const queries: string[] = [];
  const prisma = {
    withTenant: async <T>(_acc: string, fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        $queryRaw: async (q: { sql: string }) => {
          queries.push(q.sql.replace(/\s+/g, ' '));
          return Array.from({ length: opts.rows ?? 0 }, () => ({ ok: 1 }));
        },
      }),
  };
  const can = opts.can ?? [];
  const tenant = { accountId: 'acc', userId: 'u1', can: (p: string) => can.includes(p) };
  return { service: new UploadAccessService(prisma as never, tenant as never), queries };
}

describe('UploadAccessService — lectura de archivos (F14 · F1, R-06)', () => {
  it('un nombre que no es <sha256>.<ext> se rechaza sin tocar la DB (sin rutas arbitrarias)', async () => {
    const { service, queries } = make({ can: [Permission.DATA_SCOPE_ALL] });
    for (const bad of ['../etc/passwd', 'x.jpg', 'a'.repeat(64) + '.exe']) assert.equal(await service.canRead(bad), false);
    assert.equal(queries.length, 0);
  });

  it('alcance sobre toda la cuenta: se conserva el acceso de siempre, sin consultar', async () => {
    const { service, queries } = make({ can: [Permission.DATA_SCOPE_ALL] });
    assert.equal(await service.canRead(NAME), true);
    assert.equal(queries.length, 0);
  });

  it('alcance acotado: el archivo debe colgar de algo visible; si no aparece, no se lee', async () => {
    const { service, queries } = make({ rows: 0 });
    assert.equal(await service.canRead(NAME), false);
    assert.equal(queries.length, 1);
    // Cubre las siete procedencias: perfil, adjunto, ubicación, garantía, comprobante, evidencia y «lo subí yo».
    for (const t of ['profiles', 'client_attachments', 'client_locations', 'collaterals', 'payments', 'field_evidences', 'audit_logs']) {
      assert.match(queries[0]!, new RegExp(t));
    }
  });

  it('alcance acotado: si el archivo cuelga de algo visible, se lee', async () => {
    const { service } = make({ rows: 1 });
    assert.equal(await service.canRead(NAME), true);
  });
});

describe('AuthzGuard — @RolesAny (F14 · F1/F3)', () => {
  class Ctl {
    @RolesAny(Permission.CLIENT_WRITE, Permission.PAYMENT_WRITE)
    upload() {}
  }
  function guard(perms: string[]) {
    const ctx = {
      getHandler: () => Ctl.prototype.upload,
      getClass: () => Ctl,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissions: perms } }) }),
    } as unknown as ExecutionContext;
    return () => new AuthzGuard(new Reflector(), { authzDenyByDefault: true } as never).canActivate(ctx);
  }

  it('basta UNO de los permisos', () => {
    assert.equal(guard([Permission.PAYMENT_WRITE])(), true);
  });
  it('ninguno → 403', () => {
    assert.throws(guard([Permission.CLIENT_READ]));
  });
});
