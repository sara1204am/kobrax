import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { File as FileRow } from '@prisma/client';
import { FILE_LINK_TTL_MS, FilesService, type FileAccess } from './files.service';

/** F14 · F4: enlaces firmados de archivos. La política de lectura por dueño se prueba contra la base (integración). */
function make(secret = 'secreto-de-prueba-de-32-caracteres!!') {
  const audits: { action: string }[] = [];
  const tenant = { accountId: 'acc-A', userId: 'u1', can: () => true, get: () => ({ channel: 'web' }) };
  const service = new FilesService(
    {} as never,
    tenant as never,
    { record: async (e: { action: string }) => void audits.push(e) } as never,
    { fileLinkSecret: secret } as never,
  );
  const access = { file: { id: 'f1' } as FileRow, owners: [], allowed: true, auditable: false } as FileAccess;
  return { service, audits, access };
}

const parse = (url: string) => {
  const u = new URL(url, 'http://x');
  return { id: u.pathname.split('/')[3]!, acc: u.searchParams.get('acc')!, exp: Number(u.searchParams.get('exp')), sig: u.searchParams.get('sig')! };
};

describe('FilesService · enlaces firmados (F14 · F4)', () => {
  it('un enlace recién creado verifica, y su vida es de 5 minutos', async () => {
    const { service, access } = make();
    const now = 1_000_000;
    const { url, expiresAt } = await service.createLink(access, now);
    const l = parse(url);
    assert.equal(l.id, 'f1');
    assert.equal(l.exp, now + FILE_LINK_TTL_MS);
    assert.equal(new Date(expiresAt).getTime(), now + FILE_LINK_TTL_MS);
    assert.equal(service.verifyLink(l.acc, l.id, l.exp, l.sig, now + 1000), true);
  });

  it('🔴 vencido: no verifica', async () => {
    const { service, access } = make();
    const l = parse((await service.createLink(access, 1_000_000)).url);
    assert.equal(service.verifyLink(l.acc, l.id, l.exp, l.sig, l.exp + 1), false);
  });

  it('🔴 alterado: otra firma, otro vencimiento, otro archivo u otra cuenta no verifican', async () => {
    const { service, access } = make();
    const now = 1_000_000;
    const l = parse((await service.createLink(access, now)).url);
    assert.equal(service.verifyLink(l.acc, l.id, l.exp, l.sig.slice(0, -2) + 'AA', now), false, 'firma cambiada');
    assert.equal(service.verifyLink(l.acc, l.id, l.exp + 60_000, l.sig, now), false, 'vencimiento alargado');
    assert.equal(service.verifyLink(l.acc, 'f2', l.exp, l.sig, now), false, 'otro archivo');
    assert.equal(service.verifyLink('acc-B', l.id, l.exp, l.sig, now), false, 'otra cuenta');
    assert.equal(service.verifyLink(l.acc, l.id, l.exp, '', now), false, 'sin firma');
    assert.equal(service.verifyLink(l.acc, l.id, Number.NaN, l.sig, now), false, 'vencimiento inválido');
  });

  it('🔴 firmado con otro secreto no verifica (un enlace de otro entorno no sirve)', async () => {
    const a = make('secreto-A-de-prueba-de-32-caracteres!');
    const b = make('secreto-B-de-prueba-de-32-caracteres!');
    const now = 1_000_000;
    const l = parse((await a.service.createLink(a.access, now)).url);
    assert.equal(b.service.verifyLink(l.acc, l.id, l.exp, l.sig, now), false);
  });

  it('crear un enlace queda auditado como FILE_LINK', async () => {
    const { service, access, audits } = make();
    await service.createLink(access, 1);
    assert.deepEqual(audits.map((a) => a.action), ['FILE_LINK']);
  });
});
