/**
 * Push remoto (D-4) por las vías reales: API compilada, base real (la migración de `device_push_tokens` incluida, con su
 * RLS forzada) y los usuarios de verdad. Lo que los unitarios no pueden afirmar: que la migración corra desde cero, que el
 * `upsert` por (empresa, usuario, instalación) funcione contra el índice único real y que un usuario no pueda tocar los
 * dispositivos de otro.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { call, db, freshDatabase, login, startApi, stopApi } from './harness';

let prisma: PrismaClient;
let manager: string;
let collector: string;
let managerId: string;
let collectorId: string;

const token = (tag: string) => `fcm-${tag}-`.padEnd(48, 'x');

before(async () => {
  await freshDatabase();
  await startApi();
  prisma = db();
  manager = await login('manager@kobrax.demo');
  collector = await login('collector@kobrax.demo');
  managerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'manager@kobrax.demo' } })).id;
  collectorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'collector@kobrax.demo' } })).id;
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('D-4 · dispositivos de push', () => {
  const installation = randomUUID();

  it('registra el dispositivo del usuario de la sesión', async () => {
    const r = await call(collector, 'POST', '/notifications/devices', {
      installationId: installation,
      token: token('a'),
      platform: 'android',
      appVersion: '1.1.0',
      deviceName: 'Moto G',
    });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const rows = await prisma.devicePushToken.findMany({ where: { installationId: installation } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, collectorId);
    assert.equal(rows[0]!.isActive, true);
  });

  it('renovar el token de la misma instalación actualiza la fila (no la duplica)', async () => {
    const r = await call(collector, 'POST', '/notifications/devices', { installationId: installation, token: token('b') });
    assert.equal(r.status, 200);
    const rows = await prisma.devicePushToken.findMany({ where: { installationId: installation } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.token, token('b'));
  });

  it('listar devuelve los propios y NUNCA el token', async () => {
    const r = await call<{ installationId: string; token?: string }[]>(collector, 'GET', '/notifications/devices');
    assert.equal(r.status, 200);
    assert.ok(r.data!.some((d) => d.installationId === installation));
    assert.ok(r.data!.every((d) => !('token' in d)));
  });

  it('🔴 un usuario no ve ni revoca el dispositivo de otro', async () => {
    const other = await call<{ installationId: string }[]>(manager, 'GET', '/notifications/devices');
    assert.equal(other.status, 200);
    assert.ok(!other.data!.some((d) => d.installationId === installation), 'el gerente no ve el del cobrador');

    // Borrar la instalación ajena responde 204 (no revela si existe) y NO la toca.
    const del = await call(manager, 'DELETE', `/notifications/devices/${installation}`);
    assert.equal(del.status, 204);
    const still = await prisma.devicePushToken.count({ where: { installationId: installation, userId: collectorId } });
    assert.equal(still, 1);
  });

  it('el mismo token con otro usuario de la empresa desactiva al anterior', async () => {
    const shared = token('shared');
    await call(collector, 'POST', '/notifications/devices', { installationId: randomUUID(), token: shared });
    await call(manager, 'POST', '/notifications/devices', { installationId: randomUUID(), token: shared });
    const rows = await prisma.devicePushToken.findMany({ where: { token: shared } });
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.userId === collectorId)!.isActive, false, 'el anterior queda inactivo');
    assert.equal(rows.find((r) => r.userId === managerId)!.isActive, true);
  });

  it('valida el cuerpo: id que no es UUID y token vacío o ridículo se rechazan (400)', async () => {
    const a = await call(collector, 'POST', '/notifications/devices', { installationId: 'no-uuid', token: token('x') });
    assert.equal(a.status, 400);
    const b = await call(collector, 'POST', '/notifications/devices', { installationId: randomUUID(), token: 'corto' });
    assert.equal(b.status, 400);
    const c = await call(collector, 'POST', '/notifications/devices', { installationId: randomUUID(), token: token('y'), platform: 'ios' });
    assert.equal(c.status, 400);
  });

  it('sin sesión no hay acceso', async () => {
    const r = await call('', 'GET', '/notifications/devices');
    assert.equal(r.status, 401);
  });

  it('revocar el propio lo borra y repetirlo no falla', async () => {
    const first = await call(collector, 'DELETE', `/notifications/devices/${installation}`);
    assert.equal(first.status, 204);
    const second = await call(collector, 'DELETE', `/notifications/devices/${installation}`);
    assert.equal(second.status, 204);
    assert.equal(await prisma.devicePushToken.count({ where: { installationId: installation } }), 0);
  });

  it('sin credenciales de Firebase, una notificación interna se crea igual (el push apagado no rompe nada)', async () => {
    const before = await prisma.notification.count({ where: { userId: collectorId } });
    // La manager le asigna una ruta al cobrador: ROUTE_ASSIGNED es de los 6 tipos que salen por push.
    const day = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    const credits = await prisma.credit.findMany({ where: { code: 'CRD-DEMO-0003' } });
    const gen = await call(manager, 'POST', '/routes/generate', { collectorId, plannedDate: day, creditIds: [credits[0]!.id] });
    assert.equal(gen.status, 201, JSON.stringify(gen.error));
    // El aviso se entrega por un canal fire-and-forget: se espera un instante a que quede persistido.
    await new Promise((r) => setTimeout(r, 400));
    const after = await prisma.notification.count({ where: { userId: collectorId } });
    assert.ok(after > before, 'la notificación interna salió aunque FCM no esté configurado');
  });
});
