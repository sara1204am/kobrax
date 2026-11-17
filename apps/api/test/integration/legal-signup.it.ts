/**
 * Legal (B2) por las vías reales: el registro público y la aceptación de invitación contra la API compilada y Postgres de verdad.
 * Lo que los unitarios (fakes) no pueden afirmar:
 *   - que SIN aceptación no quede NADA: ni cuenta, ni usuario, ni membresía (la transacción entera se revierte);
 *   - que cada aceptación guarde la versión, el hash del servidor, la acción, el origen y la evidencia del request;
 *   - que los consentimientos opcionales solo dejen fila si se marcaron, y cada uno por separado;
 *   - que rechazar el marketing no bloquee el alta;
 *   - que una versión que dejó de ser la vigente se rechace;
 *   - que la persona invitada también acepte, y que sin aceptación la invitación NO se consuma.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { API, db, freshDatabase, resetRateLimits, startApi, stopApi } from './harness';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

let prisma: PrismaClient;
let termsId: string;
let privacyId: string;

async function publish(type: 'TERMS' | 'PRIVACY', version: string, content: string, effectiveAt = new Date()) {
  return prisma.legalDocumentVersion.create({
    data: { type, locale: 'es', version, title: type, content, contentSha256: sha(content), effectiveAt },
  });
}

before(async () => {
  await freshDatabase();
  await startApi();
  resetRateLimits();
  prisma = db();
  termsId = (await publish('TERMS', '1.0.0', 'Términos v1.0.0', new Date(Date.now() - 60_000))).id;
  privacyId = (await publish('PRIVACY', '1.0.0', 'Privacidad v1.0.0', new Date(Date.now() - 60_000))).id;
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

const newEmail = () => `legal-${randomUUID().slice(0, 8)}@ejemplo.com`;

async function signup(extra: Record<string, unknown>, headers: Record<string, string> = {}) {
  const email = newEmail();
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'legal-it/1.0', ...headers },
    body: JSON.stringify({ businessName: 'Cobranzas Legal', firstName: 'Ana', lastName: 'Prueba', email, password: 'Kobrax123!', ...extra }),
  });
  const body = (await res.json()) as { data: { accountId: string } | null; error: { code: string } | null };
  return { status: res.status, body, email };
}

const ok = { termsVersionId: '', privacyVersionId: '' };

describe('Legal · registro público', () => {
  it('🔴 sin aceptar nada responde 422 LEGAL_ACCEPTANCE_REQUIRED y NO crea usuario ni cuenta', async () => {
    const accountsBefore = await prisma.account.count();
    const r = await signup({});
    assert.equal(r.status, 422);
    assert.equal(r.body.error?.code, 'LEGAL_ACCEPTANCE_REQUIRED');
    assert.equal(await prisma.user.count({ where: { email: r.email } }), 0);
    assert.equal(await prisma.account.count(), accountsBefore);
  });

  it('🔴 aceptando solo los Términos (sin reconocer la Privacidad) tampoco se crea nada', async () => {
    const accountsBefore = await prisma.account.count();
    const r = await signup({ termsVersionId: termsId });
    assert.equal(r.status, 422);
    assert.equal(r.body.error?.code, 'LEGAL_ACCEPTANCE_REQUIRED');
    assert.equal(await prisma.user.count({ where: { email: r.email } }), 0);
    assert.equal(await prisma.account.count(), accountsBefore);
  });

  it('con ambas guarda dos constancias: versión, hash del servidor, acción, origen y evidencia; y ningún consentimiento opcional', async () => {
    Object.assign(ok, { termsVersionId: termsId, privacyVersionId: privacyId });
    const r = await signup(ok, { 'x-app-version': '0.1.0' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: r.email } });
    const rows = await prisma.userLegalAcceptance.findMany({ where: { userId: user.id }, orderBy: { action: 'asc' } });
    assert.equal(rows.length, 2);
    const t = rows.find((x) => x.documentVersionId === termsId)!;
    const p = rows.find((x) => x.documentVersionId === privacyId)!;
    assert.equal(t.action, 'ACCEPTED');
    assert.equal(p.action, 'ACKNOWLEDGED');
    // El hash es el del texto que tiene el servidor, no uno enviado por el cliente.
    assert.equal(t.contentSha256, sha('Términos v1.0.0'));
    assert.equal(p.contentSha256, sha('Privacidad v1.0.0'));
    assert.equal(t.source, 'SIGNUP_WEB');
    assert.equal(t.accountId, r.body.data!.accountId);
    assert.equal(t.userAgent, 'legal-it/1.0');
    assert.equal(t.appVersion, '0.1.0');
    assert.ok(t.ip);
    assert.ok(Math.abs(Date.now() - t.acceptedAt.getTime()) < 60_000);
    // Desmarcadas por defecto: no marcar no deja fila alguna.
    assert.equal(await prisma.consentRecord.count({ where: { userId: user.id } }), 0);
  });

  it('rechazar el marketing (false) no bloquea el alta y no deja fila de consentimiento', async () => {
    const r = await signup({ ...ok, marketingOptIn: false, analyticsOptIn: false });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: r.email } });
    assert.equal(await prisma.consentRecord.count({ where: { userId: user.id } }), 0);
  });

  it('cada consentimiento opcional que se marca deja SU propia fila de evidencia, independiente de los otros', async () => {
    const r = await signup({ ...ok, marketingOptIn: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: r.email } });
    const rows = await prisma.consentRecord.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.purpose, 'MARKETING');
    assert.equal(rows[0]!.status, 'GRANTED');
    assert.equal(rows[0]!.source, 'SIGNUP_WEB');
    assert.ok(rows[0]!.ip);

    const both = await signup({ ...ok, marketingOptIn: true, analyticsOptIn: true });
    const u2 = await prisma.user.findUniqueOrThrow({ where: { email: both.email } });
    const purposes = (await prisma.consentRecord.findMany({ where: { userId: u2.id } })).map((x) => x.purpose).sort();
    assert.deepEqual(purposes, ['ANALYTICS', 'MARKETING']);
  });

  it('desde la app móvil el origen queda como SIGNUP_MOBILE', async () => {
    const r = await signup(ok, { 'x-client-type': 'mobile' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: r.email } });
    const row = await prisma.userLegalAcceptance.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.source, 'SIGNUP_MOBILE');
  });

  it('un id que no corresponde a un documento de ese tipo se rechaza (los Términos no valen como Privacidad)', async () => {
    const r = await signup({ termsVersionId: termsId, privacyVersionId: termsId });
    assert.equal(r.status, 409);
    assert.equal(r.body.error?.code, 'LEGAL_VERSION_STALE');
    assert.equal(await prisma.user.count({ where: { email: r.email } }), 0);
  });

  it('🔴 si se publica una versión nueva mientras tanto, la vieja se rechaza (409) y no se crea nada', async () => {
    await publish('TERMS', '1.1.0', 'Términos v1.1.0');
    const accountsBefore = await prisma.account.count();
    const r = await signup(ok);
    assert.equal(r.status, 409);
    assert.equal(r.body.error?.code, 'LEGAL_VERSION_STALE');
    assert.equal(await prisma.user.count({ where: { email: r.email } }), 0);
    assert.equal(await prisma.account.count(), accountsBefore);
    // Con la versión vigente sí.
    const cur = await prisma.legalDocumentVersion.findFirstOrThrow({ where: { type: 'TERMS', version: '1.1.0' } });
    const ok2 = await signup({ termsVersionId: cur.id, privacyVersionId: privacyId });
    assert.equal(ok2.status, 201, JSON.stringify(ok2.body));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ok2.email } });
    const t = await prisma.userLegalAcceptance.findFirstOrThrow({ where: { userId: user.id, action: 'ACCEPTED' } });
    assert.equal(t.contentSha256, sha('Términos v1.1.0'));
    // La constancia anterior (v1.0.0) sigue intacta en la base: el historial no se reescribe.
    assert.equal(await prisma.userLegalAcceptance.count({ where: { documentVersionId: termsId } }) > 0, true);
  });
});

describe('Legal · aceptación de invitación', () => {
  const CODE = 'K7F29QX3TM';

  async function invitar() {
    const owner = await prisma.userAccount.findFirstOrThrow({ where: { isOwner: true }, select: { accountId: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'COLLECTOR' } });
    const email = newEmail();
    const user = await prisma.user.create({
      data: { email, passwordHash: 'x', status: 'PENDING', requiresPasswordChange: true, profile: { create: { firstName: 'Invitada', lastName: 'Prueba' } } },
    });
    await prisma.userAccount.create({ data: { userId: user.id, accountId: owner.accountId, roleId: role.id } });
    const code = `${CODE}`.replace(/.$/, String(Math.floor(Math.random() * 10)));
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha(code), expiresAt: new Date(Date.now() + 86_400_000) },
    });
    return { user, code, email };
  }

  const accept = (code: string, extra: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${API}/auth/invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ code, password: 'Kobrax123!', ...extra }),
    });

  it('🔴 sin aceptación la invitación NO se consume: el usuario sigue PENDING y el código sigue vigente', async () => {
    const { user, code } = await invitar();
    const res = await accept(code, {});
    assert.equal(res.status, 422);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.status, 'PENDING');
    const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(token.usedAt, null);
    assert.equal(await prisma.userLegalAcceptance.count({ where: { userId: user.id } }), 0);
  });

  it('aceptando los Términos y reconociendo la Privacidad activa al usuario y deja las constancias con origen INVITATION_*', async () => {
    const { user, code } = await invitar();
    const cur = await prisma.legalDocumentVersion.findFirstOrThrow({ where: { type: 'TERMS' }, orderBy: { effectiveAt: 'desc' } });
    const res = await accept(code, { termsVersionId: cur.id, privacyVersionId: privacyId, marketingOptIn: true }, { 'x-client-type': 'mobile' });
    assert.equal(res.status, 200, await res.text());
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.status, 'ACTIVE');
    const rows = await prisma.userLegalAcceptance.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.source === 'INVITATION_MOBILE'));
    assert.equal((await prisma.consentRecord.findMany({ where: { userId: user.id } })).length, 1);
  });
});
