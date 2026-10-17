import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskIp, parseUserAgent } from './connection-info';
import { decodeCursor, distinctDays, encodeCursor, keysetWhere, MemberDetailService, pageLimit } from './member-detail.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

describe('parseUserAgent', () => {
  it('distingue Edge y Chrome (Edge también dice Chrome) y el sistema', () => {
    assert.deepEqual(
      parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0'),
      { browser: 'Edge', os: 'Windows' },
    );
    assert.deepEqual(
      parseUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'),
      { browser: 'Chrome', os: 'Android' },
    );
  });

  it('reconoce la app móvil y tolera user-agent vacío', () => {
    assert.deepEqual(parseUserAgent('okhttp/4.9.2'), { browser: 'App Kobrax', os: 'Android' });
    assert.deepEqual(parseUserAgent(null), { browser: null, os: null });
  });
});

describe('maskIp', () => {
  it('oculta lo que identifica al usuario y conserva la zona', () => {
    assert.equal(maskIp('190.129.12.34'), '190.129.*.*');
    assert.equal(maskIp('::ffff:190.129.12.34'), '190.129.*.*');
    assert.equal(maskIp('2800:cd0:1:2::3'), '2800:cd0:*');
    assert.equal(maskIp(null), null);
    assert.equal(maskIp('basura'), null);
  });
});

describe('pageLimit', () => {
  it('acota el tamaño de página que pide el cliente', () => {
    assert.equal(pageLimit(NaN), 30);
    assert.equal(pageLimit(0), 30);
    assert.equal(pageLimit(-5), 30);
    assert.equal(pageLimit(10), 10);
    assert.equal(pageLimit(100000), 100);
  });
});

describe('cursor', () => {
  const AT = new Date('2026-10-12T02:40:32.996Z');
  const UUID = '0b8f5d1e-2c3a-4b6d-8e7f-9a0b1c2d3e4f';

  it('va y vuelve, y descarta lo que no tiene la forma', () => {
    const key = { at: AT, id: `p:${UUID}` };
    assert.deepEqual(decodeCursor(encodeCursor(key)), key);
    assert.deepEqual(decodeCursor(`${AT.toISOString()}|${UUID}`), { at: AT, id: UUID });
    for (const bad of [undefined, '', 'basura', `nofecha|${UUID}`, `${AT.toISOString()}|x`, `${AT.toISOString()}`]) {
      assert.equal(decodeCursor(bad), null);
    }
  });

  it('a igual instante entrega lo que sigue en el orden total y nada de lo ya entregado', () => {
    const cur = { at: AT, id: `p:${UUID}` };
    // Misma tabla: sólo los de id menor (o más viejos).
    assert.deepEqual(keysetWhere('createdAt', 'p:', cur), { OR: [{ createdAt: { lt: AT } }, { AND: [{ createdAt: AT }, { id: { lt: UUID } }] }] });
    // Prefijo menor (a:, l:): en el empate entran todos, todavía no se entregaron.
    assert.deepEqual(keysetWhere('createdAt', 'a:', cur), { OR: [{ createdAt: { lt: AT } }, { createdAt: AT }] });
    // Prefijo mayor (r:): en el empate ya salieron; sólo los más viejos.
    assert.deepEqual(keysetWhere('completedAt', 'r:', cur), { OR: [{ completedAt: { lt: AT } }] });
    assert.deepEqual(keysetWhere('createdAt', 'p:', null), {});
  });
});

describe('distinctDays', () => {
  it('cuenta días de calendario en la zona de la cuenta, no en UTC', () => {
    // 23:30 y 01:00 UTC del día siguiente son el MISMO día en La Paz (UTC-4).
    const stamps = [new Date('2026-10-12T23:30:00Z'), new Date('2026-10-13T01:00:00Z'), new Date('2026-10-14T15:00:00Z')];
    assert.equal(distinctDays(stamps, 'America/La_Paz'), 2);
    assert.equal(distinctDays(stamps, 'UTC'), 3);
  });
});

describe('MemberDetailService · aislamiento por cuenta', () => {
  it('una persona de otra cuenta es un 404 en todas las consultas', async () => {
    const wheres: unknown[] = [];
    const tx = {
      userAccount: {
        findFirst: async (args: { where: unknown }) => {
          wheres.push(args.where);
          return null;
        },
      },
    };
    const prisma = { withTenant: (_id: string, fn: (t: unknown) => unknown) => fn(tx) };
    const service = new MemberDetailService(prisma as never, { accountId: 'cuenta-a' } as never);

    await rejectsWithCode(service.detail('u-ajeno'), 'USER_NOT_FOUND');
    await rejectsWithCode(service.activity('u-ajeno', 30), 'USER_NOT_FOUND');
    await rejectsWithCode(service.activityEvents('u-ajeno', 30, null, 30), 'USER_NOT_FOUND');
    await rejectsWithCode(service.connections('u-ajeno', null, 30), 'USER_NOT_FOUND');
    await rejectsWithCode(service.audit('u-ajeno'), 'USER_NOT_FOUND');
    // La membresía se busca SIEMPRE con la cuenta del que pregunta, no sólo por el id.
    assert.equal(wheres.length, 5);
    for (const w of wheres) assert.deepEqual(w, { userId: 'u-ajeno', accountId: 'cuenta-a' });
  });
});

describe('MemberDetailService · lista por cursor', () => {
  /** Una persona con 5 gestiones, 2 pagos y ninguna ruta, de más nueva a más vieja. */
  function fake() {
    const at = (n: number) => new Date(Date.UTC(2026, 9, 10, 12, 0, n));
    const activities = [5, 4, 3, 2, 1].map((n) => ({ id: `a${n}`, createdAt: at(n * 10), type: 'CALL', client: null }));
    const payments = [45, 15].map((n) => ({ id: `p${n}`, createdAt: at(n), credit: null }));
    const tx = {
      userAccount: { findFirst: async () => ({ id: 'm1', role: { name: 'COLLECTOR' } }) },
      creditActivity: { findMany: async (a: { take: number }) => activities.slice(0, a.take) },
      payment: { findMany: async (a: { take: number }) => payments.slice(0, a.take) },
      routePlan: { findMany: async () => [] },
      auditLog: { findMany: async () => [] },
    };
    const prisma = { withTenant: (_id: string, fn: (t: unknown) => unknown) => fn(tx) };
    return new MemberDetailService(prisma as never, { accountId: 'cuenta-a' } as never);
  }

  it('mezcla las fuentes, ordena de nueva a vieja y avisa si hay más', async () => {
    const page = await fake().activityEvents('u1', 90, null, 4);
    assert.deepEqual(page.items.map((e) => e.id), ['a:a5', 'p:p45', 'a:a4', 'a:a3']);
    assert.notEqual(page.nextCursor, null);
    assert.equal(page.nextCursor, `${page.items[3]!.at}|${page.items[3]!.id}`);
  });

  it('en la última página no hay cursor', async () => {
    const page = await fake().activityEvents('u1', 90, null, 50);
    assert.equal(page.items.length, 7);
    assert.equal(page.nextCursor, null);
  });
});
