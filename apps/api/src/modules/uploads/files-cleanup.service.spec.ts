import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FilesCleanupService, ORPHAN_TTL_MS, PENDING_TTL_MS } from './files-cleanup.service';

/** F14 · F4 (D-6): la limpieza de archivos. Con un doble de la base: se comprueban las CONDICIONES, que son lo que protege los datos. */
function make(opts: { old?: { id: string; storageKey: string }[]; locked?: boolean } = {}) {
  const calls: { op: string; where?: Record<string, unknown>; data?: Record<string, unknown>; sql?: string }[] = [];
  const removed: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      calls.push({ op: 'lock', sql: strings.join('?') });
      return opts.locked === false ? [] : [{ id: 'x' }];
    },
    file: {
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.push({ op: 'updateMany', where: a.where, data: a.data });
        return { count: 2 };
      },
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.push({ op: 'findMany', where: a.where });
        return opts.old ?? [];
      },
      update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.push({ op: 'update', where: a.where, data: a.data });
        return {};
      },
    },
  };
  const prisma = { withSystemTenant: async (_acc: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const uploads = { removeForAccount: async (_acc: string, key: string) => void removed.push(key) };
  return { service: new FilesCleanupService(prisma as never, uploads as never), calls, removed };
}

const NOW = new Date('2026-11-10T12:00:00Z');
const KEY = (c: string, ext = 'png') => `${c.repeat(64)}.${ext}`;

describe('FilesCleanupService (F14 · F4, D-6)', () => {
  it('🔴 un PENDING sin dueños de más de 24 h (desde la última subida) pasa a ORPHAN; nunca toca uno con dueños', async () => {
    const { service, calls } = make();
    const r = await service.cleanAccount('acc-A', NOW);
    assert.equal(r.orphaned, 2);
    const mark = calls.find((c) => c.op === 'updateMany')!;
    assert.equal(mark.where?.status, 'PENDING');
    assert.deepEqual(mark.where?.owners, { none: {} }, 'sólo los que no tienen NINGÚN dueño');
    assert.equal((mark.where?.updatedAt as { lt: Date }).lt.getTime(), NOW.getTime() - PENDING_TTL_MS, 'el plazo corre desde la última subida, no desde la primera');
    assert.equal(mark.data?.status, 'ORPHAN');
  });

  it('🔴 un ORPHAN sin dueños de más de 7 días se borra BAJO BLOQUEO de fila: se marca y recién ahí se borra el archivo físico', async () => {
    const { service, calls, removed } = make({ old: [{ id: 'f1', storageKey: KEY('a') }, { id: 'f2', storageKey: KEY('b', 'jpg') }] });
    const r = await service.cleanAccount('acc-A', NOW);
    assert.equal(r.deleted, 2);
    assert.deepEqual(removed, [KEY('a'), KEY('b', 'jpg')]);
    const find = calls.find((c) => c.op === 'findMany')!;
    assert.equal(find.where?.status, 'ORPHAN');
    assert.deepEqual(find.where?.owners, { none: {} });
    assert.equal((find.where?.orphanedAt as { lt: Date }).lt.getTime(), NOW.getTime() - ORPHAN_TTL_MS);
    const locks = calls.filter((c) => c.op === 'lock');
    assert.equal(locks.length, 2);
    for (const l of locks) {
      assert.match(l.sql ?? '', /FOR UPDATE/);
      assert.match(l.sql ?? '', /status = 'ORPHAN'/);
      assert.match(l.sql ?? '', /NOT EXISTS \(SELECT 1 FROM file_owners/);
    }
    assert.equal(calls.filter((c) => c.op === 'update' && c.data?.deletedAt).length, 2);
  });

  it('🔴 si bajo el bloqueo el archivo ya no es huérfano sin dueños (lo revivió una subida o lo ató algo), NO se marca ni se borra el físico', async () => {
    const { service, calls, removed } = make({ old: [{ id: 'f1', storageKey: KEY('a') }], locked: false });
    const r = await service.cleanAccount('acc-A', NOW);
    assert.equal(r.deleted, 0);
    assert.deepEqual(removed, []);
    assert.equal(calls.filter((c) => c.op === 'update').length, 0);
  });
});
