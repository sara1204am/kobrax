/**
 * Confirmación del correo al crear la cuenta — de punta a punta contra la API compilada y Postgres de verdad.
 *   - el alta crea un enlace de un solo uso (solo su huella en la base) y la cuenta nace SIN confirmar;
 *   - sin confirmar se puede entrar y trabajar, pero invitar personas y exportar datos dan 403 EMAIL_UNVERIFIED;
 *   - confirmar con el enlace desbloquea esas acciones, sirve una sola vez, y un enlace vencido o inventado no confirma nada;
 *   - reenviar anula el enlace anterior y respeta el minuto de espera;
 *   - quien acepta una invitación nace confirmado.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/email-verification.it.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { API, call, db, freshDatabase, legalAcceptance, loginSkippingMfa, resetRateLimits, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin = '';
const email = `titular-${suffix}@ejemplo.com`;
let userId = '';

const post = async (path: string, token: string | null, body?: unknown) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string } };
  return { status: res.status, data: json.data, error: json.error };
};
const hashOf = (t: string) => createHash('sha256').update(t).digest('hex');
const exportStatus = async () => (await fetch(`${API}/exports/clients`, { headers: { Authorization: `Bearer ${admin}` } })).status;

before(async () => {
  resetRateLimits();
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: 'Cobranzas Sur', planCode: 'PROFESSIONAL', firstName: 'Titular', lastName: 'A', email, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  admin = await loginSkippingMfa(email, { keepUnverified: true });
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('al crear la cuenta', () => {
  it('🔴 nace SIN confirmar y con un enlace de un solo uso: en la base solo está su huella', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.emailVerifiedAt, null);
    const tokens = await prisma.emailVerificationToken.findMany({ where: { userId } });
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0]!.tokenHash.length, 64);
    assert.equal(tokens[0]!.usedAt, null);
    assert.ok(tokens[0]!.expiresAt.getTime() > Date.now() + 40 * 3600 * 1000, 'vence en ~48 h');
  });

  it('`/auth/me` informa que el correo no está confirmado', async () => {
    const me = await call<{ emailVerified: boolean }>(admin, 'GET', '/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data?.emailVerified, false);
  });
});

describe('sin confirmar: se trabaja, pero lo sensible se frena', () => {
  it('🔴 exportar datos e invitar personas dan 403 EMAIL_UNVERIFIED', async () => {
    assert.equal(await exportStatus(), 403);
    const invite = await call(admin, 'POST', '/users/invite', { email: 'nuevo@ejemplo.com' });
    assert.equal(invite.status, 403);
    assert.equal(invite.error?.code, 'EMAIL_UNVERIFIED');
  });

  it('entrar y leer lo propio sigue funcionando (un error de tipeo en el correo no deja a nadie fuera)', async () => {
    assert.equal((await call(admin, 'GET', '/accounts/me')).status, 200);
  });
});

describe('confirmar con el enlace', () => {
  const token = `enlace-de-prueba-${suffix}-0123456789abcdef`;

  it('🔴 un enlace inventado o con forma inválida no confirma nada', async () => {
    assert.equal((await post('/auth/email/verify', null, { token: 'x'.repeat(43) })).status, 404);
    assert.equal((await post('/auth/email/verify', null, { token: 'corto' })).status, 400);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt, null);
  });

  it('🔴 un enlace vencido no confirma', async () => {
    const expired = `vencido-${suffix}-0123456789abcdef0123456789`;
    await prisma.emailVerificationToken.create({ data: { userId, tokenHash: hashOf(expired), expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await post('/auth/email/verify', null, { token: expired })).status, 404);
  });

  it('reenviar respeta el minuto de espera (no manda otro tan seguido)', async () => {
    const r = await post('/auth/email/resend', admin);
    assert.equal(r.status, 200);
    assert.equal(r.data?.sent, false);
  });

  it('con el enlace válido confirma, desbloquea lo sensible y el enlace sirve UNA sola vez', async () => {
    await prisma.emailVerificationToken.create({ data: { userId, tokenHash: hashOf(token), expiresAt: new Date(Date.now() + 3600_000) } });
    const ok = await post('/auth/email/verify', null, { token });
    assert.equal(ok.status, 200, JSON.stringify(ok.error));
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt);
    assert.equal((await post('/auth/email/verify', null, { token })).status, 404, 'el enlace sirve una sola vez');
    assert.equal(await exportStatus(), 200, 'ya puede exportar');
    const me = await call<{ emailVerified: boolean }>(admin, 'GET', '/auth/me');
    assert.equal(me.data?.emailVerified, true);
    const invite = await call(admin, 'POST', '/users/invite', { email: 'nuevo@ejemplo.com' });
    assert.notEqual(invite.error?.code, 'EMAIL_UNVERIFIED', 'ya no lo frena la confirmación (puede fallar por otra validación)');
  });

  it('una cuenta ya confirmada no recibe más enlaces', async () => {
    const before = await prisma.emailVerificationToken.count({ where: { userId } });
    const r = await post('/auth/email/resend', admin);
    assert.equal(r.data?.sent, false);
    assert.equal(await prisma.emailVerificationToken.count({ where: { userId } }), before);
  });
});

describe('invitación', () => {
  it('🔴 quien acepta una invitación nace confirmado (el código le llegó a ese correo)', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'COLLECTOR' } });
    const inv = await call<{ invitationCode?: string }>(admin, 'POST', '/users/invite', { email: `cobrador-${suffix}@ejemplo.com`, firstName: 'Co', lastName: 'Brador', roleId: role.id });
    assert.equal(inv.status, 201, JSON.stringify(inv.error));
    const code = String(inv.data?.invitationCode ?? '');
    assert.ok(code, 'la invitación entrega el código');
    const accept = await post('/auth/invitation/accept', null, { code, password: 'Kobrax123!', ...(await legalAcceptance()) });
    assert.equal(accept.status, 200, JSON.stringify(accept.error));
    const invited = await prisma.user.findUniqueOrThrow({ where: { email: `cobrador-${suffix}@ejemplo.com` } });
    assert.ok(invited.emailVerifiedAt, 'nace confirmado');
  });
});
