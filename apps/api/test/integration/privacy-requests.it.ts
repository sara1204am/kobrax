/**
 * Privacidad (B6) — solicitudes de derechos, de punta a punta contra la API compilada y Postgres de verdad.
 * Lo que los unitarios (fakes) no pueden afirmar:
 *   - que una cuenta NUNCA vea ni toque las solicitudes de otra (RLS + filtro) y que los dos orígenes no se mezclen;
 *   - que la máquina de estados se cumpla con la base real y deje un evento por cada paso;
 *   - que los eventos y las solicitudes sean imborrables incluso para el rol de la aplicación (REVOKE + trigger);
 *   - que solo la persona de plataforma atienda las solicitudes de personas usuarias, y no las de las organizaciones;
 *   - que sin permiso (`account:write`) el personal no registre solicitudes de titulares.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashSync } from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { totpNow } from '../../src/modules/auth/totp';
import { API, addMember, appDb, call, db, freshDatabase, legalAcceptance, login, loginSkippingMfa, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
const ENROLL_KEY = `it-enroll-${suffix}-0123456789`;
const PLATFORM_EMAIL = `root-${suffix}@kobrax.test`;
const PLATFORM_PASSWORD = 'Plataforma-clave-1';

interface Req {
  id: string;
  subjectKind: string;
  type: string;
  status: string;
  subjectLabel: string | null;
  description: string;
  rejectionReason: string | null;
  closedAt: string | null;
  events: { status: string; note: string | null; actorKind: string }[];
  allowedNext: string[];
  requester?: { email: string };
}

let prisma: PrismaClient;
let app: PrismaClient;
const acc: Record<string, { id: string; admin: string; email: string }> = {};
let collector = '';
let platform = '';

async function signup(label: string) {
  const email = `${label}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Empresa ${label}`, firstName: 'Dueño', lastName: label, email, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  return { id: owner.userAccounts[0]!.accountId, admin: await loginSkippingMfa(email), email };
}

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
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', PLATFORM_ACCESS_ENABLED: 'true', PLATFORM_ENROLLMENT_KEY: ENROLL_KEY });
  prisma = db();
  app = appDb();
  acc.A = await signup('a');
  acc.B = await signup('b');
  await addMember(prisma, acc.A.id, `colector-${suffix}@ejemplo.com`, 'Colector', 'COLLECTOR');
  collector = await login(`colector-${suffix}@ejemplo.com`);
  // La persona de plataforma (MFA obligatorio): se enrola y confirma como en F5.
  await prisma.platformUser.create({ data: { email: PLATFORM_EMAIL, passwordHash: hashSync(PLATFORM_PASSWORD, 4) } });
  const first = await post('/platform/auth/login', null, { email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD, enrollmentKey: ENROLL_KEY });
  const secret = String(first.data?.secret);
  const done = await post('/platform/auth/mfa/confirm', null, { email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD, code: totpNow(secret), enrollmentKey: ENROLL_KEY });
  assert.equal(done.status, 200, JSON.stringify(done.error));
  platform = String(done.data?.accessToken);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
  await app?.$disconnect();
});

const own = { type: 'ACCESS', description: 'Quiero saber qué datos suyos tiene Kobrax sobre mi cuenta.' };
const org = { type: 'ERASURE', subjectLabel: 'Juan Pérez · CI 1234567', description: 'El titular pide que se elimine su información de contacto.' };

describe('B6 · solicitudes propias (APP_USER)', () => {
  let idA = '';

  it('🔴 una persona presenta una solicitud sobre SUS datos: queda «Recibida», con su primer evento y SIN ids internos en la respuesta', async () => {
    const r = await call<Req>(acc.A!.admin, 'POST', '/privacy/requests', own);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    idA = r.data!.id;
    assert.equal(r.data!.status, 'RECEIVED');
    assert.equal(r.data!.subjectKind, 'APP_USER');
    assert.deepEqual(r.data!.events.map((e) => `${e.status}:${e.actorKind}`), ['RECEIVED:REQUESTER']);
    assert.ok(!('requesterUserId' in r.data!) && !('accountId' in r.data!), 'no se exponen ids internos');
    // En la base es personal: sin cuenta.
    const row = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: idA } });
    assert.equal(row.accountId, null);
  });

  it('🔴 cada persona ve solo las suyas: otra cuenta no las ve', async () => {
    const mine = await call<Req[]>(acc.A!.admin, 'GET', '/privacy/requests/mine');
    assert.deepEqual(mine.data!.map((x) => x.id), [idA]);
    const other = await call<Req[]>(acc.B!.admin, 'GET', '/privacy/requests/mine');
    assert.deepEqual(other.data, []);
  });

  it('una descripción corta o un tipo inválido se rechazan (400)', async () => {
    assert.equal((await call(acc.A!.admin, 'POST', '/privacy/requests', { ...own, description: 'corta' })).status, 400);
    assert.equal((await call(acc.A!.admin, 'POST', '/privacy/requests', { ...own, type: 'INVENTADO' })).status, 400);
  });

  it('el tope de solicitudes abiertas por persona se aplica (10) y no afecta a otras', async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await call(acc.B!.admin, 'POST', '/privacy/requests', own)).status, 201);
    const eleventh = await call(acc.B!.admin, 'POST', '/privacy/requests', own);
    assert.equal(eleventh.status, 409);
    assert.equal(eleventh.error?.code, 'PRIVACY_REQUEST_TOO_MANY_OPEN');
    // A sigue pudiendo.
    assert.equal((await call(acc.A!.admin, 'POST', '/privacy/requests', own)).status, 201);
  });
});

describe('B6 · solicitudes de la organización (DEBTOR_VIA_ORG)', () => {
  let debtorId = '';

  it('🔴 sin `account:write` el personal no puede registrar ni ver solicitudes de titulares', async () => {
    assert.equal((await call(collector, 'POST', '/privacy/requests/org', org)).status, 403);
    assert.equal((await call(collector, 'GET', '/privacy/requests/org')).status, 403);
  });

  it('el administrador registra la solicitud de un titular: vive en SU cuenta y es de la organización', async () => {
    const r = await call<Req>(acc.A!.admin, 'POST', '/privacy/requests/org', org);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    debtorId = r.data!.id;
    assert.equal(r.data!.subjectKind, 'DEBTOR_VIA_ORG');
    assert.equal(r.data!.subjectLabel, org.subjectLabel);
    assert.deepEqual(r.data!.events.map((e) => e.actorKind), ['ORG']);
    const row = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: debtorId } });
    assert.equal(row.accountId, acc.A!.id);
  });

  it('🔴 aislamiento: otra cuenta NO la ve en su lista y NO puede cambiarla (404)', async () => {
    const own = await call<Req[]>(acc.A!.admin, 'GET', '/privacy/requests/org');
    assert.deepEqual(own.data!.map((x) => x.id), [debtorId]);
    const other = await call<Req[]>(acc.B!.admin, 'GET', '/privacy/requests/org');
    assert.deepEqual(other.data, []);
    const hijack = await call(acc.B!.admin, 'PATCH', `/privacy/requests/org/${debtorId}/status`, { status: 'IN_REVIEW' });
    assert.equal(hijack.status, 404);
    assert.equal((await prisma.privacyRequest.findUniqueOrThrow({ where: { id: debtorId } })).status, 'RECEIVED');
  });

  it('los dos orígenes no se mezclan: la solicitud personal no aparece en la lista de la organización', async () => {
    const list = await call<Req[]>(acc.A!.admin, 'GET', '/privacy/requests/org');
    assert.ok(list.data!.every((x) => x.subjectKind === 'DEBTOR_VIA_ORG'));
  });

  it('🔴 RLS en la base: sin contexto de cuenta, la aplicación NO ve ninguna solicitud de una organización', async () => {
    const rows = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM privacy_requests WHERE subject_kind = 'DEBTOR_VIA_ORG'`;
    assert.equal(Number(rows[0]!.n), 0);
    const personal = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM privacy_requests WHERE subject_kind = 'APP_USER'`;
    assert.ok(Number(personal[0]!.n) > 0, 'las personales (sin cuenta) sí se ven: las filtra la aplicación por quien las presentó');
  });

  it('🔴 la máquina de estados: no se salta pasos, rechazar exige justificación y pedir información exige decir qué falta', async () => {
    const patch = (body: unknown) => call<Req>(acc.A!.admin, 'PATCH', `/privacy/requests/org/${debtorId}/status`, body);
    assert.equal((await patch({ status: 'COMPLETED' })).status, 409); // no se salta de Recibida a Completada
    assert.equal((await patch({ status: 'REJECTED' })).status, 422); // sin justificación
    assert.equal((await patch({ status: 'IN_REVIEW' })).status, 200);
    assert.equal((await patch({ status: 'NEEDS_INFO' })).status, 422); // sin decir qué falta
    const needs = await patch({ status: 'NEEDS_INFO', note: 'Necesitamos copia de la cédula del titular.' });
    assert.equal(needs.status, 200, JSON.stringify(needs.error));
    assert.equal((await patch({ status: 'IN_REVIEW' })).status, 200);
    assert.equal((await patch({ status: 'APPROVED' })).status, 200);
    const done = await patch({ status: 'COMPLETED', note: 'Se eliminaron los datos de contacto.' });
    assert.equal(done.status, 200);
    assert.deepEqual(done.data!.events.map((e) => e.status), ['RECEIVED', 'IN_REVIEW', 'NEEDS_INFO', 'IN_REVIEW', 'APPROVED', 'COMPLETED']);
    assert.ok(done.data!.closedAt);
    assert.deepEqual(done.data!.allowedNext, []);
    // Un estado final no cambia más.
    assert.equal((await patch({ status: 'IN_REVIEW' })).status, 409);
  });

  it('rechazar con justificación deja la solicitud cerrada y la razón guardada', async () => {
    const r = await call<Req>(acc.A!.admin, 'POST', '/privacy/requests/org', org);
    const id = r.data!.id;
    await call(acc.A!.admin, 'PATCH', `/privacy/requests/org/${id}/status`, { status: 'IN_REVIEW' });
    const rej = await call<Req>(acc.A!.admin, 'PATCH', `/privacy/requests/org/${id}/status`, { status: 'REJECTED', rejectionReason: 'Hay una obligación legal de conservar el registro.' });
    assert.equal(rej.status, 200, JSON.stringify(rej.error));
    assert.equal(rej.data!.status, 'REJECTED');
    assert.equal(rej.data!.rejectionReason, 'Hay una obligación legal de conservar el registro.');
    assert.ok(rej.data!.closedAt);
  });
});

describe('B6 · inmutabilidad', () => {
  it('🔴 la aplicación no puede borrar solicitudes ni modificar o borrar eventos; ni el dueño de las tablas modifica un evento', async () => {
    const ev = await prisma.privacyRequestEvent.findFirstOrThrow();
    const req = await prisma.privacyRequest.findFirstOrThrow();
    await assert.rejects(app.privacyRequest.delete({ where: { id: req.id } }));
    await assert.rejects(app.privacyRequestEvent.update({ where: { id: ev.id }, data: { note: 'x' } }));
    await assert.rejects(app.privacyRequestEvent.delete({ where: { id: ev.id } }));
    await assert.rejects(prisma.privacyRequestEvent.update({ where: { id: ev.id }, data: { note: 'x' } }), /solo INSERT/);
    await assert.rejects(prisma.privacyRequestEvent.delete({ where: { id: ev.id } }), /solo INSERT/);
    await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "privacy_request_events"'), /solo INSERT/);
  });
});

describe('B6 · plataforma atiende a las personas usuarias', () => {
  let personal = '';
  let debtor = '';

  it('🔴 solo la persona de plataforma ve la cola; un administrador de empresa recibe 403 y sin sesión 401', async () => {
    assert.equal((await call(acc.A!.admin, 'GET', '/platform/privacy-requests')).status, 403);
    assert.equal((await fetch(`${API}/platform/privacy-requests`)).status, 401);
    const list = await call<Req[]>(platform, 'GET', '/platform/privacy-requests');
    assert.equal(list.status, 200, JSON.stringify(list.error));
    assert.ok(list.data!.length > 0);
    // La cola es SOLO de personas usuarias: nunca las de las organizaciones (esas las atiende su responsable).
    assert.ok(list.data!.every((x) => x.subjectKind === 'APP_USER'));
    assert.ok(list.data!.every((x) => typeof x.requester?.email === 'string'));
    personal = list.data!.find((x) => x.requester!.email === acc.A!.email)!.id;
  });

  it('la plataforma cambia el estado de una solicitud personal y queda el evento PLATFORM, visible para la persona', async () => {
    const r = await call<Req>(platform, 'PATCH', `/platform/privacy-requests/${personal}/status`, { status: 'IN_REVIEW', note: 'Estamos revisando tu pedido.' });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data!.status, 'IN_REVIEW');
    assert.equal(r.data!.events.at(-1)!.actorKind, 'PLATFORM');
    const mine = await call<Req[]>(acc.A!.admin, 'GET', '/privacy/requests/mine');
    const seen = mine.data!.find((x) => x.id === personal)!;
    assert.equal(seen.status, 'IN_REVIEW');
    assert.equal(seen.events.at(-1)!.note, 'Estamos revisando tu pedido.');
  });

  it('🔴 la plataforma NO puede tocar la solicitud de un titular de cobranza (404): su responsable es la organización', async () => {
    const mineOrg = await call<Req[]>(acc.A!.admin, 'GET', '/privacy/requests/org');
    debtor = mineOrg.data![0]!.id;
    const r = await call(platform, 'PATCH', `/platform/privacy-requests/${debtor}/status`, { status: 'IN_REVIEW' });
    assert.equal(r.status, 404);
  });

  it('la plataforma también respeta la máquina de estados (no se salta de Recibida a Completada)', async () => {
    const fresh = await call<Req>(acc.A!.admin, 'POST', '/privacy/requests', own);
    const r = await call(platform, 'PATCH', `/platform/privacy-requests/${fresh.data!.id}/status`, { status: 'COMPLETED' });
    assert.equal(r.status, 409);
  });
});
