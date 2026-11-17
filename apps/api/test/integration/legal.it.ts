/**
 * Legal (B1) por las vías reales: API compilada y base recreada desde cero con TODAS las migraciones y los scripts rls/ (el 007 incluido).
 * Lo que los unitarios no pueden afirmar:
 *   - que la BASE impida UPDATE, DELETE y TRUNCATE sobre la evidencia, también al rol de la aplicación y también al dueño de las tablas;
 *   - que el rol de la aplicación SÍ pueda insertar y leer;
 *   - que una versión publicada no se pueda duplicar y que el historial se conserve;
 *   - que la versión vigente se lea por el endpoint público, con el hash del texto.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { API, appDb, db, freshDatabase, startApi, stopApi } from './harness';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const TEXT = 'Términos y Condiciones de prueba — versión 1';

let admin: PrismaClient;
let app: PrismaClient;
let userId: string;
let versionId: string;

before(async () => {
  await freshDatabase();
  await startApi();
  admin = db();
  app = appDb();
  userId = (await admin.user.findFirstOrThrow()).id;
  const v = await admin.legalDocumentVersion.create({
    data: { type: 'TERMS', locale: 'es', version: '1.0.0', title: 'Términos', content: TEXT, contentSha256: sha(TEXT) },
  });
  versionId = v.id;
});

after(async () => {
  stopApi();
  await admin?.$disconnect();
  await app?.$disconnect();
});

const acceptance = (over: Record<string, unknown> = {}) => ({
  userId,
  documentVersionId: versionId,
  contentSha256: sha(TEXT),
  action: 'ACCEPTED' as const,
  source: 'SIGNUP_WEB' as const,
  ip: '203.0.113.9',
  ...over,
});

describe('Legal · evidencia inmutable en la base', () => {
  it('el rol de la aplicación puede insertar y leer una aceptación; la hora la pone la base', async () => {
    const row = await app.userLegalAcceptance.create({ data: acceptance() });
    assert.ok(row.acceptedAt instanceof Date);
    assert.equal(Math.abs(Date.now() - row.acceptedAt.getTime()) < 60_000, true);
    const read = await app.userLegalAcceptance.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(read.contentSha256, sha(TEXT));
  });

  it('🔴 el rol de la aplicación NO puede modificar ni borrar una aceptación', async () => {
    const row = await app.userLegalAcceptance.findFirstOrThrow({ where: { userId } });
    await assert.rejects(app.userLegalAcceptance.update({ where: { id: row.id }, data: { ip: '0.0.0.0' } }));
    await assert.rejects(app.userLegalAcceptance.delete({ where: { id: row.id } }));
    const after = await admin.userLegalAcceptance.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.ip, '203.0.113.9');
  });

  it('🔴 ni siquiera el dueño de las tablas puede: lo impide el trigger', async () => {
    const row = await admin.userLegalAcceptance.findFirstOrThrow({ where: { userId } });
    await assert.rejects(
      admin.userLegalAcceptance.update({ where: { id: row.id }, data: { ip: '0.0.0.0' } }),
      /solo INSERT/,
    );
    await assert.rejects(admin.userLegalAcceptance.delete({ where: { id: row.id } }), /solo INSERT/);
    await assert.rejects(admin.$executeRawUnsafe('TRUNCATE "user_legal_acceptances"'), /solo INSERT/);
  });

  it('🔴 una versión publicada no se edita ni se borra, ni por la app ni por el dueño', async () => {
    await assert.rejects(app.legalDocumentVersion.update({ where: { id: versionId }, data: { content: 'otro texto' } }));
    await assert.rejects(admin.legalDocumentVersion.update({ where: { id: versionId }, data: { content: 'otro texto' } }), /solo INSERT/);
    await assert.rejects(admin.legalDocumentVersion.delete({ where: { id: versionId } }), /solo INSERT/);
    const v = await admin.legalDocumentVersion.findUniqueOrThrow({ where: { id: versionId } });
    assert.equal(v.content, TEXT);
  });

  it('🔴 el historial de un consentimiento opcional no se reescribe: retirar es insertar una fila nueva', async () => {
    const base = { userId, purpose: 'MARKETING' as const, source: 'PROFILE' as const };
    const granted = await app.consentRecord.create({ data: { ...base, status: 'GRANTED' } });
    await app.consentRecord.create({ data: { ...base, status: 'WITHDRAWN' } });
    await assert.rejects(app.consentRecord.update({ where: { id: granted.id }, data: { status: 'WITHDRAWN' } }));
    await assert.rejects(app.consentRecord.delete({ where: { id: granted.id } }));
    const rows = await admin.consentRecord.findMany({ where: { userId, purpose: 'MARKETING' }, orderBy: { recordedAt: 'asc' } });
    assert.deepEqual(rows.map((r) => r.status), ['GRANTED', 'WITHDRAWN']);
  });

  it('una persona no puede aceptar dos veces la misma versión con la misma acción', async () => {
    await assert.rejects(app.userLegalAcceptance.create({ data: acceptance() }), /Unique constraint/);
  });

  it('no se puede publicar dos veces la misma versión del mismo documento', async () => {
    await assert.rejects(
      admin.legalDocumentVersion.create({
        data: { type: 'TERMS', locale: 'es', version: '1.0.0', title: 'Otra', content: 'x', contentSha256: sha('x') },
      }),
      /Unique constraint/,
    );
  });
});

describe('Legal · lectura pública y versiones', () => {
  it('la versión vigente se lee SIN sesión y trae el hash del texto', async () => {
    const res = await fetch(`${API}/legal/documents/terms/current`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { version: string; content: string; contentSha256: string } };
    assert.equal(body.data.version, '1.0.0');
    assert.equal(body.data.contentSha256, sha(body.data.content));
  });

  it('al publicar otra versión, la nueva es la vigente y la anterior sigue consultable', async () => {
    const t2 = 'Términos y Condiciones de prueba — versión 1.1';
    await admin.legalDocumentVersion.create({
      data: { type: 'TERMS', locale: 'es', version: '1.1.0', title: 'Términos', content: t2, contentSha256: sha(t2), isMaterial: true },
    });
    const cur = (await (await fetch(`${API}/legal/documents/terms/current`)).json()) as { data: { version: string } };
    assert.equal(cur.data.version, '1.1.0');
    const old = (await (await fetch(`${API}/legal/documents/terms/versions/1.0.0`)).json()) as {
      data: { content: string };
    };
    assert.equal(old.data.content, TEXT);
    const list = (await (await fetch(`${API}/legal/documents/terms/versions`)).json()) as {
      data: { version: string }[];
    };
    assert.deepEqual(list.data.map((v) => v.version).sort(), ['1.0.0', '1.1.0']);
  });

  it('un documento desconocido responde 400 y uno sin publicar, 404', async () => {
    assert.equal((await fetch(`${API}/legal/documents/inventado/current`)).status, 400);
    assert.equal((await fetch(`${API}/legal/documents/privacy/current`)).status, 404);
  });
});
