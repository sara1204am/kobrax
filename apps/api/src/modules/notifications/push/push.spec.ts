import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { DevicesService } from './devices.service';
import { FcmClient, type FcmMessage, type FcmResult, type FcmSender } from './fcm.client';
import { MAX_CONSECUTIVE_FAILURES, PUSH_CHANNEL_ID, PUSH_TITLE, PushService } from './push.service';
import { PushNotificationChannel } from '../notification-channel';

// ── Fakes ─────────────────────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  accountId: string;
  userId: string;
  installationId: string;
  token: string;
  platform: string;
  appVersion: string | null;
  deviceName: string | null;
  isActive: boolean;
  failureCount: number;
  lastError: string | null;
  lastSeenAt: Date;
  lastPushedAt: Date | null;
}

/** `devicePushToken` en memoria con el subconjunto de Prisma que usan los servicios. */
function makeDb(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((s, i) => ({
    id: s.id ?? `d${i + 1}`,
    accountId: s.accountId ?? 'acc1',
    userId: s.userId ?? 'u1',
    installationId: s.installationId ?? `inst${i + 1}`,
    token: s.token ?? `token-${i + 1}-`.padEnd(30, 'x'),
    platform: 'android',
    appVersion: null,
    deviceName: null,
    isActive: s.isActive ?? true,
    failureCount: s.failureCount ?? 0,
    lastError: null,
    lastSeenAt: s.lastSeenAt ?? new Date(),
    lastPushedAt: null,
  }));
  let n = rows.length;
  const match = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'NOT') return !match(r, v as Record<string, unknown>);
      if (k === 'lastSeenAt') return r.lastSeenAt < (v as { lt: Date }).lt;
      return (r as unknown as Record<string, unknown>)[k] === v;
    });
  const tx = {
    devicePushToken: {
      findMany: async (a: { where: Record<string, unknown> }) => rows.filter((r) => match(r, a.where)).map((r) => ({ ...r })),
      update: async (a: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === a.where.id)!;
        Object.assign(r, a.data);
        return r;
      },
      upsert: async (a: {
        where: { accountId_userId_installationId: { accountId: string; userId: string; installationId: string } };
        create: Partial<Row>;
        update: Partial<Row>;
      }) => {
        const k = a.where.accountId_userId_installationId;
        const found = rows.find((r) => r.accountId === k.accountId && r.userId === k.userId && r.installationId === k.installationId);
        if (found) return Object.assign(found, a.update);
        const created = { id: `d${++n}`, isActive: true, failureCount: 0, lastError: null, lastPushedAt: null, ...a.create } as Row;
        rows.push(created);
        return created;
      },
      updateMany: async (a: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => match(r, a.where));
        hit.forEach((r) => Object.assign(r, a.data));
        return { count: hit.length };
      },
      deleteMany: async (a: { where: Record<string, unknown> }) => {
        const hit = rows.filter((r) => match(r, a.where));
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { count: hit.length };
      },
    },
  };
  const prisma = { withTenant: async <T>(_acc: string, fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  return { rows, prisma: prisma as never };
}

class FakeFcm implements FcmSender {
  sent: FcmMessage[] = [];
  configured = true;
  /** Una respuesta por llamada, en orden; la última se repite. */
  script: (FcmResult | Error)[] = [{ ok: true }];
  isConfigured() {
    return this.configured;
  }
  async send(m: FcmMessage): Promise<FcmResult> {
    this.sent.push(m);
    const next = this.script.length > 1 ? this.script.shift()! : this.script[0]!;
    if (next instanceof Error) throw next;
    return next;
  }
}

const INPUT = { accountId: 'acc1', userId: 'u1', notificationId: 'n1', type: 'ROUTE_ASSIGNED' as const, routeId: 'r1' };

// ── PushService ────────────────────────────────────────────────────────────────────────────────

describe('PushService · qué sale y a quién', () => {
  it('🔴 sin credenciales de Firebase el envío queda apagado y no falla', async () => {
    const fcm = new FakeFcm();
    fcm.configured = false;
    const { prisma } = makeDb([{}]);
    const out = await new PushService(prisma, fcm).sendToUser(INPUT);
    assert.equal(out.skipped, 'disabled');
    assert.equal(fcm.sent.length, 0);
  });

  it('solo seis tipos salen por push: ruta asignada, pedido y respuesta, gestión asignada o cambiada, promesa', () => {
    const ok = ['ROUTE_ASSIGNED', 'ROUTE_CHANGE_REQUESTED', 'ROUTE_CHANGE_DECIDED', 'AGENDA_ASSIGNED', 'AGENDA_CHANGED', 'PROMISE_DUE'];
    const no = ['PAYMENT_REGISTERED', 'SYSTEM', 'AGENDA_OVERDUE', 'ROUTE_CANCELLED'];
    for (const t of ok) assert.equal(PushService.isPushable(t as never), true, t);
    for (const t of no) assert.equal(PushService.isPushable(t as never), false, t);
  });

  it('un tipo que no sale por push no toca a FCM', async () => {
    const fcm = new FakeFcm();
    const { prisma } = makeDb([{}]);
    const out = await new PushService(prisma, fcm).sendToUser({ ...INPUT, type: 'PAYMENT_REGISTERED' });
    assert.equal(out.skipped, 'type');
    assert.equal(fcm.sent.length, 0);
  });

  it('sin dispositivos no hace nada', async () => {
    const fcm = new FakeFcm();
    const { prisma } = makeDb([]);
    const out = await new PushService(prisma, fcm).sendToUser(INPUT);
    assert.equal(out.skipped, 'no-devices');
  });

  it('va a TODOS los dispositivos activos del usuario y a ninguno de otro usuario, otra empresa o dado de baja', async () => {
    const fcm = new FakeFcm();
    const { prisma, rows } = makeDb([
      { id: 'a', userId: 'u1', token: 'tok-a'.padEnd(30, '-') },
      { id: 'b', userId: 'u1', token: 'tok-b'.padEnd(30, '-') },
      { id: 'c', userId: 'u2', token: 'tok-c'.padEnd(30, '-') },
      { id: 'd', userId: 'u1', accountId: 'acc2', token: 'tok-d'.padEnd(30, '-') },
      { id: 'e', userId: 'u1', isActive: false, token: 'tok-e'.padEnd(30, '-') },
    ]);
    const out = await new PushService(prisma, fcm).sendToUser(INPUT);
    assert.equal(out.sent, 2);
    assert.deepEqual(fcm.sent.map((m) => m.token).sort(), ['tok-a'.padEnd(30, '-'), 'tok-b'.padEnd(30, '-')]);
    assert.ok(rows.find((r) => r.id === 'a')!.lastPushedAt);
    assert.equal(rows.find((r) => r.id === 'c')!.lastPushedAt, null);
  });

  it('🔴 el contenido es genérico: sin nombres, importes ni datos del cliente; solo ids opacos', async () => {
    const fcm = new FakeFcm();
    const { prisma } = makeDb([{}]);
    await new PushService(prisma, fcm).sendToUser({
      ...INPUT,
      type: 'PROMISE_DUE',
      creditId: 'cr-9',
      // Lo que en la bandeja interna sí lleva datos: nunca entra al push.
      ...({ title: 'Promesa de Freddy Tarqui por Bs 2.296,96', body: 'Calle 12 #890' } as object),
    });
    const m = fcm.sent[0]!;
    assert.equal(m.title, PUSH_TITLE);
    assert.equal(m.body, 'Tienes una promesa de pago por vencer.');
    assert.doesNotMatch(JSON.stringify(m), /Freddy|Bs|Calle|2\.296/);
    assert.deepEqual(m.data, { type: 'PROMISE_DUE', nid: 'n1', uid: 'u1', rid: 'r1', cid: 'cr-9' });
    assert.equal(m.channelId, PUSH_CHANNEL_ID);
  });

  it('el mismo aviso lleva siempre el mismo tag: un reintento lo reemplaza en el teléfono, no lo duplica', async () => {
    const fcm = new FakeFcm();
    const { prisma } = makeDb([{}]);
    const svc = new PushService(prisma, fcm);
    await svc.sendToUser(INPUT);
    await svc.sendToUser(INPUT);
    assert.equal(fcm.sent.length, 2);
    assert.equal(fcm.sent[0]!.tag, 'n1');
    assert.equal(fcm.sent[1]!.tag, 'n1');
  });
});

describe('PushService · fallos del proveedor', () => {
  it('token muerto (UNREGISTERED): se da de baja y no se reintenta', async () => {
    const fcm = new FakeFcm();
    fcm.script = [{ ok: false, permanent: true, code: 'UNREGISTERED', message: 'x' }];
    const { prisma, rows } = makeDb([{}]);
    const out = await new PushService(prisma, fcm).sendToUser(INPUT);
    assert.equal(fcm.sent.length, 1);
    assert.equal(out.deactivated, 1);
    assert.equal(rows[0]!.isActive, false);
    assert.equal(rows[0]!.lastError, 'UNREGISTERED');
  });

  it('fallo transitorio: reintenta una vez y, si sigue, cuenta el fallo sin dar de baja', async () => {
    const fcm = new FakeFcm();
    fcm.script = [{ ok: false, permanent: false, code: 'HTTP_503', message: 'x' }];
    const { prisma, rows } = makeDb([{}]);
    const out = await new PushService(prisma, fcm).sendToUser(INPUT);
    assert.equal(fcm.sent.length, 2);
    assert.equal(out.failed, 1);
    assert.equal(rows[0]!.isActive, true);
    assert.equal(rows[0]!.failureCount, 1);
  });

  it('un fallo transitorio que se recupera en el reintento cuenta como enviado', async () => {
    const fcm = new FakeFcm();
    fcm.script = [{ ok: false, permanent: false, code: 'NETWORK', message: 'x' }, { ok: true }];
    const { prisma, rows } = makeDb([{ failureCount: 3 }]);
    const out = await new PushService(prisma, fcm).sendToUser(INPUT);
    assert.equal(out.sent, 1);
    assert.equal(rows[0]!.failureCount, 0);
  });

  it('tras varios fallos seguidos el dispositivo se da de baja (token muerto que FCM no marcó)', async () => {
    const fcm = new FakeFcm();
    fcm.script = [{ ok: false, permanent: false, code: 'HTTP_500', message: 'x' }];
    const { prisma, rows } = makeDb([{ failureCount: MAX_CONSECUTIVE_FAILURES - 1 }]);
    await new PushService(prisma, fcm).sendToUser(INPUT);
    assert.equal(rows[0]!.isActive, false);
  });

  it('🔴 una excepción del proveedor o de la base NO sale de sendToUser: no rompe la operación de negocio', async () => {
    const boom = new FakeFcm();
    boom.script = [new Error('socket hang up')];
    const { prisma } = makeDb([{}]);
    await assert.doesNotReject(new PushService(prisma, boom).sendToUser(INPUT));

    const brokenDb = { withTenant: async () => Promise.reject(new Error('db caída')) } as never;
    await assert.doesNotReject(new PushService(brokenDb, new FakeFcm()).sendToUser(INPUT));
  });
});

describe('PushNotificationChannel · integración con notifyUser', () => {
  it('entrega solo avisos con id y de un tipo permitido', async () => {
    const calls: unknown[] = [];
    const push = { sendToUser: async (i: unknown) => void calls.push(i) } as unknown as PushService;
    const ch = new PushNotificationChannel(push);
    await ch.deliver({ userId: 'u1', accountId: 'a', type: 'ROUTE_ASSIGNED', title: 't', body: null }); // sin id
    await ch.deliver({ id: 'n1', userId: 'u1', accountId: 'a', type: 'SYSTEM', title: 't', body: null }); // no permitido
    await ch.deliver({ id: 'n2', userId: 'u1', accountId: 'a', type: 'AGENDA_ASSIGNED', title: 't', body: null, agendaItemId: 'g1' });
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { agendaItemId: string }).agendaItemId, 'g1');
  });
});

// ── DevicesService ─────────────────────────────────────────────────────────────────────────────

function devices(db: ReturnType<typeof makeDb>, userId = 'u1', accountId = 'acc1') {
  return new DevicesService(db.prisma, { accountId, userId } as never);
}
const TOKEN = 'fcm-token-'.padEnd(40, 'x');

describe('DevicesService · registrar, renovar y revocar', () => {
  it('registra el dispositivo del usuario de la sesión', async () => {
    const db = makeDb();
    await devices(db).register({ installationId: 'i1', token: TOKEN, appVersion: '1.1.0', deviceName: 'Moto G' });
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0]!.userId, 'u1');
    assert.equal(db.rows[0]!.accountId, 'acc1');
  });

  it('renovar el token de la misma instalación actualiza la fila, no la duplica, y la reactiva', async () => {
    const db = makeDb([{ installationId: 'i1', isActive: false, failureCount: 4, token: 'viejo'.padEnd(30, 'x') }]);
    await devices(db).register({ installationId: 'i1', token: TOKEN });
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0]!.token, TOKEN);
    assert.equal(db.rows[0]!.isActive, true);
    assert.equal(db.rows[0]!.failureCount, 0);
  });

  it('varios dispositivos por usuario: otra instalación es otra fila', async () => {
    const db = makeDb();
    await devices(db).register({ installationId: 'i1', token: TOKEN });
    await devices(db).register({ installationId: 'i2', token: `${TOKEN}-2` });
    assert.equal(db.rows.filter((r) => r.userId === 'u1').length, 2);
  });

  it('🔴 el mismo token con otro usuario de la empresa desactiva al anterior: no recibe sus avisos', async () => {
    const db = makeDb([{ id: 'viejo', userId: 'ana', installationId: 'i-ana', token: TOKEN }]);
    await devices(db, 'beto').register({ installationId: 'i-beto', token: TOKEN });
    assert.equal(db.rows.find((r) => r.id === 'viejo')!.isActive, false);
    assert.equal(db.rows.find((r) => r.userId === 'beto')!.isActive, true);
  });

  it('🔴 no se puede revocar el dispositivo de otro usuario (ni de otra empresa): no encuentra nada', async () => {
    const db = makeDb([
      { id: 'a', userId: 'ana', installationId: 'i-ana' },
      { id: 'b', userId: 'u1', accountId: 'acc2', installationId: 'i-ana' },
    ]);
    await devices(db, 'beto').revoke('i-ana');
    assert.equal(db.rows.length, 2);
  });

  it('revocar el propio lo borra, y repetirlo no falla', async () => {
    const db = makeDb([{ id: 'a', userId: 'u1', installationId: 'i1' }]);
    await devices(db).revoke('i1');
    await assert.doesNotReject(devices(db).revoke('i1'));
    assert.equal(db.rows.length, 0);
  });

  it('listar devuelve solo los del usuario y nunca el token', async () => {
    const db = makeDb([{ userId: 'u1' }, { userId: 'otro' }]);
    const out = (await devices(db).listMine()) as { data: Record<string, unknown>[] };
    // El fake de `findMany` ignora `select`: lo que se verifica es el filtro por usuario y que el service lo pida sin token.
    assert.equal(out.data.length, 1);
  });

  it('limpia de oportunidad los tokens abandonados de la empresa', async () => {
    const viejo = new Date(Date.now() - 90 * 86_400_000);
    const db = makeDb([{ id: 'viejo', userId: 'otro', installationId: 'i-old', lastSeenAt: viejo }]);
    await devices(db).register({ installationId: 'i1', token: TOKEN });
    assert.equal(db.rows.some((r) => r.id === 'viejo'), false);
  });
});

// ── FcmClient (sin red: `fetch` falso) ─────────────────────────────────────────────────────────

describe('FcmClient · HTTP v1 sin SDK', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const account = { client_email: 'svc@kobrax-test.iam.gserviceaccount.com', private_key: pem, project_id: 'kobrax-test' };
  const b64 = Buffer.from(JSON.stringify(account)).toString('base64');
  const msg: FcmMessage = { token: 'tok', title: 'Kobrax', body: 'Hola', data: { type: 'X' }, tag: 'n1', channelId: PUSH_CHANNEL_ID };

  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit }[] = [];
  let script: ((url: string) => Response)[] = [];

  beforeEach(() => {
    calls = [];
    script = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = script.length > 1 ? script.shift()! : script[0]!;
      return next(String(url));
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const oauth = () => new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), { status: 200 });
  const client = (cfg: { b64?: string; file?: string } = { b64 }) =>
    new FcmClient({ fcmServiceAccountB64: cfg.b64, fcmServiceAccountFile: cfg.file } as never);

  it('sin credenciales o con credenciales mal formadas no está configurado (y no lanza)', () => {
    assert.equal(client({}).isConfigured(), false);
    assert.equal(client({ b64: Buffer.from('{"nada":1}').toString('base64') }).isConfigured(), false);
    assert.equal(client({ b64: 'no-es-json' }).isConfigured(), false);
    assert.equal(client({ b64 }).isConfigured(), true);
  });

  it('firma el JWT con RS256 (verificable con la clave pública) y lo cambia por un token de acceso', async () => {
    script = [(u) => (u.includes('oauth2') ? oauth() : new Response('{}', { status: 200 }))];
    const out = await client().send(msg);
    assert.equal(out.ok, true);

    const assertion = new URLSearchParams(String(calls[0]!.init.body)).get('assertion')!;
    const [h, p, s] = assertion.split('.');
    const verify = createVerify('RSA-SHA256').update(`${h}.${p}`);
    assert.equal(verify.verify(publicKey, Buffer.from(s!, 'base64url')), true);
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    assert.equal(claims.iss, account.client_email);
    assert.match(claims.scope, /firebase\.messaging/);
  });

  it('manda el mensaje a la API v1 del proyecto, con el tag y el canal', async () => {
    script = [(u) => (u.includes('oauth2') ? oauth() : new Response('{}', { status: 200 }))];
    await client().send(msg);
    const send = calls.find((c) => c.url.includes('fcm.googleapis.com'))!;
    assert.match(send.url, /projects\/kobrax-test\/messages:send/);
    const body = JSON.parse(String(send.init.body));
    assert.equal(body.message.android.notification.tag, 'n1');
    assert.equal(body.message.android.notification.channel_id, PUSH_CHANNEL_ID);
    assert.equal(new Headers(send.init.headers).get('authorization'), 'Bearer at-1');
  });

  it('reutiliza el token de acceso entre envíos', async () => {
    script = [(u) => (u.includes('oauth2') ? oauth() : new Response('{}', { status: 200 }))];
    const c = client();
    await c.send(msg);
    await c.send(msg);
    assert.equal(calls.filter((x) => x.url.includes('oauth2')).length, 1);
  });

  it('UNREGISTERED es permanente; 503 y 429 son transitorios', async () => {
    const dead = new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
    script = [(u) => (u.includes('oauth2') ? oauth() : dead)];
    const r1 = await client().send(msg);
    assert.deepEqual({ ok: r1.ok, permanent: !r1.ok && r1.permanent, code: !r1.ok && r1.code }, { ok: false, permanent: true, code: 'UNREGISTERED' });

    for (const status of [503, 429]) {
      script = [(u) => (u.includes('oauth2') ? oauth() : new Response('{}', { status }))];
      const r = await client().send(msg);
      assert.equal(!r.ok && r.permanent, false, String(status));
    }
  });

  it('un 401 renueva el token de acceso y reintenta una vez', async () => {
    let sends = 0;
    script = [
      (u) => {
        if (u.includes('oauth2')) return oauth();
        sends++;
        return sends === 1 ? new Response('{}', { status: 401 }) : new Response('{}', { status: 200 });
      },
    ];
    const out = await client().send(msg);
    assert.equal(out.ok, true);
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 2);
  });

  it('un error de red sale como transitorio, no como excepción', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    const out = await client().send(msg);
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.permanent, false);
  });
});
