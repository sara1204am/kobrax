/**
 * Legal (B4/B5) por las vías reales: lo propio de cada persona (Mi perfil › Privacidad) y la re-aceptación, contra la API compilada y
 * Postgres de verdad. Lo que los unitarios (fakes) no pueden afirmar:
 *   - que la clave salga de la sesión: una persona nunca ve ni toca lo de otra;
 *   - que un cambio EDITORIAL no pida nada y uno MATERIAL sí, con las versiones reales de la base;
 *   - que re-aceptar sea idempotente y deje evidencia (origen, cuenta, hash) sin duplicar;
 *   - que otorgar y retirar un consentimiento inserten filas nuevas (el historial no se reescribe);
 *   - que sin sesión no se pueda leer nada.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { API, addMember, call, db, freshDatabase, login, startApi, stopApi } from './harness';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const HOUR = 3_600_000;

interface Overview {
  pending: { type: string; versionId: string; version: string }[];
  acceptances: { type: string; version: string; action: string; source: string; contentSha256: string }[];
  consents: { purpose: string; status: string; decided: boolean }[];
  history: { purpose: string; status: string; source: string }[];
}

let prisma: PrismaClient;
let mgr: string;
let col: string;
let mgrId: string;
let colId: string;
const ids: Record<string, string> = {};

async function publish(key: string, type: 'TERMS' | 'PRIVACY', version: string, hoursAgo: number, isMaterial: boolean) {
  const content = `${type} ${version}`;
  const v = await prisma.legalDocumentVersion.create({
    data: { type, locale: 'es', version, title: type, content, contentSha256: sha(content), isMaterial, effectiveAt: new Date(Date.now() - hoursAgo * HOUR) },
  });
  ids[key] = v.id;
}

before(async () => {
  await freshDatabase();
  await startApi();
  prisma = db();
  await publish('t1', 'TERMS', '1.0.0', 10, true);
  await publish('p1', 'PRIVACY', '1.0.0', 10, true);
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: 'manager@kobrax.demo' }, include: { userAccounts: true } });
  mgrId = manager.id;
  const accountId = manager.userAccounts[0]!.accountId;
  colId = await addMember(prisma, accountId, 'colector-legal@kobrax.demo', 'Colector', 'COLLECTOR');
  mgr = await login('manager@kobrax.demo');
  col = await login('colector-legal@kobrax.demo');
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

const me = async (token: string) => {
  const r = await call<Overview>(token, 'GET', '/legal/me');
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data!;
};

describe('Legal · lo propio y re-aceptación', () => {
  it('🔴 sin sesión no se puede leer nada propio', async () => {
    const res = await fetch(`${API}/legal/me`);
    assert.equal(res.status, 401);
  });

  it('una persona que nunca aceptó tiene los dos documentos pendientes y ningún consentimiento decidido', async () => {
    const o = await me(mgr);
    assert.deepEqual(o.pending.map((p) => p.type).sort(), ['PRIVACY', 'TERMS']);
    assert.deepEqual(o.acceptances, []);
    assert.ok(o.consents.every((c) => c.status === 'WITHDRAWN' && c.decided === false));
  });

  it('🔴 re-aceptar guarda las dos constancias (origen, cuenta, hash del servidor), deja la lista vacía y es idempotente', async () => {
    const r = await call<Overview>(mgr, 'POST', '/legal/acceptances', { termsVersionId: ids.t1, privacyVersionId: ids.p1 });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data!.pending, []);
    const rows = await prisma.userLegalAcceptance.findMany({ where: { userId: mgrId } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.source === 'RE_ACCEPT' && x.accountId !== null && x.ip));
    assert.equal(rows.find((x) => x.documentVersionId === ids.t1)!.contentSha256, sha('TERMS 1.0.0'));
    await call(mgr, 'POST', '/legal/acceptances', { termsVersionId: ids.t1, privacyVersionId: ids.p1 });
    assert.equal(await prisma.userLegalAcceptance.count({ where: { userId: mgrId } }), 2);
    const o = await me(mgr);
    assert.deepEqual(o.acceptances.map((a) => `${a.type}:${a.action}`).sort(), ['PRIVACY:ACKNOWLEDGED', 'TERMS:ACCEPTED']);
  });

  it('🔴 un cambio EDITORIAL no pide nada; uno MATERIAL sí, solo del documento que cambió', async () => {
    await publish('t11', 'TERMS', '1.1.0', 6, false);
    assert.deepEqual((await me(mgr)).pending, []);
    await publish('t2', 'TERMS', '2.0.0', 3, true);
    const o = await me(mgr);
    assert.deepEqual(o.pending.map((p) => `${p.type}:${p.version}`), ['TERMS:2.0.0']);
    assert.equal(o.pending[0]!.versionId, ids.t2);
  });

  it('🔴 re-aceptar con una versión que ya no es la vigente se rechaza (409) y no guarda nada', async () => {
    const before = await prisma.userLegalAcceptance.count({ where: { userId: mgrId } });
    const r = await call(mgr, 'POST', '/legal/acceptances', { termsVersionId: ids.t1, privacyVersionId: ids.p1 });
    assert.equal(r.status, 409);
    assert.equal(await prisma.userLegalAcceptance.count({ where: { userId: mgrId } }), before);
    const ok = await call<Overview>(mgr, 'POST', '/legal/acceptances', { termsVersionId: ids.t2, privacyVersionId: ids.p1 });
    assert.equal(ok.status, 200, JSON.stringify(ok.error));
    assert.deepEqual(ok.data!.pending, []);
    // El historial anterior sigue intacto: ahora hay constancias de v1.0.0 Y de v2.0.0.
    const versions = (await me(mgr)).acceptances.filter((a) => a.type === 'TERMS').map((a) => a.version).sort();
    assert.deepEqual(versions, ['1.0.0', '2.0.0']);
  });

  it('🔴 otorgar y retirar un consentimiento inserta filas NUEVAS; pedir el mismo estado no inserta nada', async () => {
    const put = (granted: unknown, purpose = 'MARKETING') => call<Overview>(mgr, 'PUT', `/legal/consents/${purpose}`, { granted });
    let r = await put(true);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data!.consents.find((c) => c.purpose === 'MARKETING')!.status, 'GRANTED');
    await put(true);
    assert.equal(await prisma.consentRecord.count({ where: { userId: mgrId, purpose: 'MARKETING' } }), 1);
    r = await put(false);
    assert.equal(r.data!.consents.find((c) => c.purpose === 'MARKETING')!.status, 'WITHDRAWN');
    const rows = await prisma.consentRecord.findMany({ where: { userId: mgrId, purpose: 'MARKETING' }, orderBy: { recordedAt: 'asc' } });
    assert.deepEqual(rows.map((x) => x.status), ['GRANTED', 'WITHDRAWN']);
    assert.ok(rows.every((x) => x.source === 'PROFILE' && x.ip));
    assert.equal(r.data!.history.length, 2);
  });

  it('una finalidad desconocida o un cuerpo inválido se rechazan con 400', async () => {
    assert.equal((await call(mgr, 'PUT', '/legal/consents/INVENTADA', { granted: true })).status, 400);
    assert.equal((await call(mgr, 'PUT', '/legal/consents/MARKETING', { granted: 'si' })).status, 400);
    assert.equal((await call(mgr, 'PUT', '/legal/consents/MARKETING', {})).status, 400);
  });
});

describe('Legal · aislamiento entre personas', () => {
  it('🔴 otra persona de la misma cuenta NO ve las aceptaciones ni los consentimientos de la primera', async () => {
    const o = await me(col);
    assert.deepEqual(o.acceptances, []);
    assert.deepEqual(o.history, []);
    assert.ok(o.consents.every((c) => c.decided === false));
    // Y tiene los documentos pendientes: lo de la otra persona no la cubre.
    assert.deepEqual(o.pending.map((p) => p.type).sort(), ['PRIVACY', 'TERMS']);
  });

  it('🔴 lo que hace una persona no toca las filas de la otra', async () => {
    await call(col, 'PUT', '/legal/consents/MARKETING', { granted: true });
    assert.equal(await prisma.consentRecord.count({ where: { userId: colId, purpose: 'MARKETING' } }), 1);
    assert.equal(await prisma.consentRecord.count({ where: { userId: mgrId, purpose: 'MARKETING' } }), 2);
    const mine = await me(mgr);
    assert.equal(mine.consents.find((c) => c.purpose === 'MARKETING')!.status, 'WITHDRAWN');
  });

  it('🔴 el id de la persona no se puede forzar desde el cuerpo: se rechaza (o se ignora) y nunca se escribe en otra persona', async () => {
    const before = await prisma.userLegalAcceptance.count({ where: { userId: mgrId } });
    const r = await call(col, 'POST', '/legal/acceptances', { termsVersionId: ids.t2, privacyVersionId: ids.p1, userId: mgrId } as never);
    assert.ok(r.status === 400 || r.status === 200, `status ${r.status}`);
    // La primera persona no ganó constancias de más, pase lo que pase con la petición de la segunda.
    assert.equal(await prisma.userLegalAcceptance.count({ where: { userId: mgrId } }), before);
    if (r.status === 200) assert.ok((await prisma.userLegalAcceptance.count({ where: { userId: colId } })) > 0);
  });
});

describe('Legal · re-aceptación parcial', () => {
  it('🔴 si cambió UN solo documento se acepta solo ese: no se registra nada del otro', async () => {
    await publish('t3', 'TERMS', '3.0.0', 1, true);
    const before = await prisma.userLegalAcceptance.count({ where: { userId: mgrId } });
    const o = await me(mgr);
    assert.deepEqual(o.pending.map((p) => `${p.type}:${p.version}`), ['TERMS:3.0.0']);
    const r = await call<Overview>(mgr, 'POST', '/legal/acceptances', { termsVersionId: ids.t3 });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data!.pending, []);
    // Una sola constancia nueva (la de los Términos): la Política no se tocó.
    assert.equal(await prisma.userLegalAcceptance.count({ where: { userId: mgrId } }), before + 1);
  });

  it('sin mandar ninguno de los dos se rechaza (422) y no guarda nada', async () => {
    const before = await prisma.userLegalAcceptance.count({ where: { userId: mgrId } });
    const r = await call(mgr, 'POST', '/legal/acceptances', {});
    assert.equal(r.status, 422);
    assert.equal(await prisma.userLegalAcceptance.count({ where: { userId: mgrId } }), before);
  });
});
