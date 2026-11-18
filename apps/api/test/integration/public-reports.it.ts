/**
 * Reportes públicos y consola de plataforma — de punta a punta contra la API compilada y Postgres de verdad.
 * Lo que los unitarios (fakes) no pueden afirmar:
 *   - que una persona SIN cuenta pueda reportar (sin token) y que la fila quede como THIRD_PARTY, sin usuario, ya normalizada;
 *   - que la trampa anti-robot no guarde nada y que un tipo fuera de la lista cerrada se rechace;
 *   - que solo la persona de plataforma vea y atienda esos reportes (un administrador de empresa no);
 *   - que la plataforma pueda LISTAR cuentas de todas las empresas (la función SECURITY DEFINER) pero un administrador de empresa no;
 *   - que suspender corte el inicio de sesión de la cuenta, exija motivo, deje auditoría y que reactivar lo restablezca.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/public-reports.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashSync } from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { totpNow } from '../../src/modules/auth/totp';
import { API, call, db, freshDatabase, legalAcceptance, loginSkippingMfa, resetRateLimits, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
const ENROLL_KEY = `it-enroll-${suffix}-0123456789`;
const PLATFORM_EMAIL = `root-${suffix}@kobrax.test`;
const PLATFORM_PASSWORD = 'Plataforma-clave-1';

let prisma: PrismaClient;
let platform = '';
let adminA = '';
let accountA = '';
let emailA = '';

const post = async (path: string, token: string | null, body?: unknown) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string } };
  return { status: res.status, data: json.data, error: json.error };
};

before(async () => {
  resetRateLimits();
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', PLATFORM_ACCESS_ENABLED: 'true', PLATFORM_ENROLLMENT_KEY: ENROLL_KEY });
  prisma = db();
  emailA = `a-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: 'Cobranzas Sur', firstName: 'Dueño', lastName: 'A', email: emailA, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  accountA = (await prisma.user.findUniqueOrThrow({ where: { email: emailA }, include: { userAccounts: true } })).userAccounts[0]!.accountId;
  adminA = await loginSkippingMfa(emailA);
  await prisma.platformUser.create({ data: { email: PLATFORM_EMAIL, passwordHash: hashSync(PLATFORM_PASSWORD, 4) } });
  const first = await post('/platform/auth/login', null, { email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD, enrollmentKey: ENROLL_KEY });
  const done = await post('/platform/auth/mfa/confirm', null, { email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD, code: totpNow(String(first.data?.secret)), enrollmentKey: ENROLL_KEY });
  assert.equal(done.status, 200, JSON.stringify(done.error));
  platform = String(done.data?.accessToken);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

const report = { type: 'ABUSE_REPORT', contactEmail: 'Persona@Ejemplo.com', contactName: 'Persona', reportedSubject: 'Cobranzas Sur', description: 'Me llaman a toda hora y a mi trabajo.' };

describe('formulario público (sin cuenta)', () => {
  let ref = '';

  it('🔴 una persona sin sesión reporta: queda THIRD_PARTY, sin usuario, con el correo en minúsculas, y solo recibe un código', async () => {
    const r = await post('/public/reports', null, report);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    ref = String(r.data?.reference);
    assert.match(ref, /^[0-9A-F]{8}$/);
    assert.deepEqual(Object.keys(r.data ?? {}), ['reference']);
    const row = await prisma.privacyRequest.findFirstOrThrow({ where: { contactEmail: 'persona@ejemplo.com' }, include: { events: true } });
    assert.equal(row.subjectKind, 'THIRD_PARTY');
    assert.equal(row.requesterUserId, null);
    assert.equal(row.accountId, null);
    assert.equal(row.id.slice(0, 8).toUpperCase(), ref);
    assert.deepEqual(row.events.map((e) => `${e.status}:${e.actorKind}`), ['RECEIVED:REQUESTER']);
  });

  it('🔴 la trampa llena responde igual pero NO guarda nada', async () => {
    const before = await prisma.privacyRequest.count();
    const r = await post('/public/reports', null, { ...report, contactEmail: 'robot@spam.com', website: 'http://spam.example' });
    assert.equal(r.status, 201);
    assert.equal(await prisma.privacyRequest.count(), before);
  });

  it('🔴 un tipo fuera de la lista cerrada, o un correo inválido, se rechazan (400)', async () => {
    assert.equal((await post('/public/reports', null, { ...report, type: 'PORTABILITY' })).status, 400);
    assert.equal((await post('/public/reports', null, { ...report, contactEmail: 'no-es-correo' })).status, 400);
  });

  it('la constraint de la base impide una fila THIRD_PARTY sin correo de contacto', async () => {
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO privacy_requests (id, subject_kind, type, description, updated_at) VALUES ('x-${suffix}', 'THIRD_PARTY', 'ABUSE_REPORT', 'sin correo ni usuario', now())`,
      ),
      /third_party_contact/,
    );
  });
});

describe('consola de plataforma · reportes', () => {
  let id = '';

  it('🔴 un administrador de empresa NO ve ni atiende los reportes (solo la plataforma)', async () => {
    assert.equal((await call(adminA, 'GET', '/platform/privacy-requests')).status, 403);
  });

  it('la plataforma ve el reporte, con el contacto de quien escribió y sin usuario', async () => {
    const r = await call<{ id: string; subjectKind: string; requester: { email: string; name: string | null }; allowedNext: string[] }[]>(platform, 'GET', '/platform/privacy-requests');
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const mine = r.data!.find((x) => x.requester.email === 'persona@ejemplo.com');
    assert.ok(mine, 'el reporte público aparece en la bandeja');
    assert.equal(mine!.subjectKind, 'THIRD_PARTY');
    assert.equal(mine!.requester.name, 'Persona');
    assert.deepEqual(mine!.allowedNext, ['IN_REVIEW', 'REJECTED']);
    id = mine!.id;
  });

  it('la plataforma lo lleva por la máquina de estados, y rechazar exige justificación', async () => {
    assert.equal((await call(platform, 'PATCH', `/platform/privacy-requests/${id}/status`, { status: 'IN_REVIEW' })).status, 200);
    const noReason = await call(platform, 'PATCH', `/platform/privacy-requests/${id}/status`, { status: 'REJECTED' });
    assert.equal(noReason.status, 422);
    const ok = await call<{ status: string }>(platform, 'PATCH', `/platform/privacy-requests/${id}/status`, { status: 'REJECTED', rejectionReason: 'No corresponde a ninguna cuenta de Kobrax' });
    assert.equal(ok.data?.status, 'REJECTED');
    const events = await prisma.privacyRequestEvent.findMany({ where: { requestId: id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(events.map((e) => e.status), ['RECEIVED', 'IN_REVIEW', 'REJECTED']);
    assert.equal(events[2]!.actorKind, 'PLATFORM');
  });
});

describe('consola de plataforma · cuentas', () => {
  it('🔴 un administrador de empresa NO puede listar cuentas ni suspender', async () => {
    assert.equal((await call(adminA, 'GET', '/platform/accounts')).status, 403);
    assert.equal((await call(adminA, 'POST', `/platform/accounts/${accountA}/status`, { status: 'SUSPENDED', reason: 'intento de un administrador' })).status, 403);
  });

  it('la plataforma busca cuentas de todas las empresas (la función SECURITY DEFINER) con lo mínimo para identificarlas', async () => {
    const all = await call<{ accountId: string; businessName: string; status: string; ownerEmail: string | null }[]>(platform, 'GET', '/platform/accounts');
    assert.equal(all.status, 200, JSON.stringify(all.error));
    const mine = all.data!.find((a) => a.accountId === accountA);
    assert.ok(mine);
    assert.equal(mine!.businessName, 'Cobranzas Sur');
    assert.equal(mine!.ownerEmail, emailA);
    assert.deepEqual(Object.keys(mine!).sort(), ['accountId', 'businessName', 'createdAt', 'ownerEmail', 'planCode', 'status']);
    const found = await call<unknown[]>(platform, 'GET', '/platform/accounts?q=sur');
    assert.equal(found.data!.length, 1);
    assert.equal((await call<unknown[]>(platform, 'GET', '/platform/accounts?q=inexistente')).data!.length, 0);
  });

  it('🔴 suspender exige motivo; con motivo corta el inicio de sesión, deja auditoría y reactivar lo restablece', async () => {
    assert.equal((await call(platform, 'POST', `/platform/accounts/${accountA}/status`, { status: 'SUSPENDED', reason: 'corto' })).status, 400);
    assert.equal((await call(platform, 'POST', `/platform/accounts/${accountA}/status`, { status: 'CANCELLED', reason: 'otro estado no permitido' })).status, 400);

    const susp = await call<{ status: string }>(platform, 'POST', `/platform/accounts/${accountA}/status`, { status: 'SUSPENDED', reason: 'Reporte de hostigamiento confirmado' });
    assert.equal(susp.status, 200, JSON.stringify(susp.error));
    assert.equal(susp.data?.status, 'SUSPENDED');

    // La cuenta entera deja de poder iniciar sesión.
    const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailA, password: 'Kobrax123!' }) });
    assert.notEqual(login.status, 200, 'una cuenta suspendida no debe poder entrar');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { accountId: accountA, entity: 'account' }, orderBy: { createdAt: 'desc' } });
    const after = audit.after as { status: string; reason: string; via: string; platformUserId: string };
    assert.equal(after.status, 'SUSPENDED');
    assert.equal(after.reason, 'Reporte de hostigamiento confirmado');
    assert.equal(after.via, 'platform:suspend');
    assert.ok(after.platformUserId);

    // No se suspende dos veces.
    assert.equal((await call(platform, 'POST', `/platform/accounts/${accountA}/status`, { status: 'SUSPENDED', reason: 'Otro motivo suficientemente largo' })).status, 409);

    const lift = await call<{ status: string }>(platform, 'POST', `/platform/accounts/${accountA}/status`, { status: 'ACTIVE', reason: 'Se resolvió el reclamo del titular' });
    assert.equal(lift.data?.status, 'ACTIVE');
    // Y solo se reactiva una suspendida.
    assert.equal((await call(platform, 'POST', `/platform/accounts/${accountA}/status`, { status: 'ACTIVE', reason: 'Ya estaba activa, no corresponde' })).status, 409);
    const again = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailA, password: 'Kobrax123!' }) });
    assert.notEqual(again.status, 403, 'tras reactivar ya no se rechaza por estar suspendida');
  });
});
