import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FilesCleanupService, ORPHAN_TTL_MS, PENDING_TTL_MS } from './files-cleanup.service';

/** F14 · F4 (D-6): la limpieza de archivos. Con un doble de la base: se comprueban las CONDICIONES, que son lo que protege los datos. */
function make(opts: { old?: { id: string; storageKey: string }[]; markedCount?: number } = {}) {
  const calls: { op: string; where: Record<string, unknown>; data?: Record<string, unknown> }[] = [];
  const removed: string[] = [];
  const tx = {
    file: {
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.push({ op: 'updateMany', where: a.where, data: a.data });
        return { count: 'status' in a.where && a.where.status === 'PENDING' ? 2 : (opts.markedCount ?? 1) };
      },
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.push({ op: 'findMany', where: a.where });
        return opts.old ?? [];
      },
    },
  };
  const prisma = { withSystemTenant: async (_acc: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const uploads = { removeForAccount: async (_acc: string, key: string) => void removed.push(key) };
  return { service: new FilesCleanupService(prisma as never, uploads as never), calls, removed };
}

const NOW = new Date('2026-11-10T12:00:00Z');

describe('FilesCleanupService (F14 · F4, D-6)', () => {
  it('🔴 un PENDING sin dueños de más de 24 h pasa a ORPHAN; nunca toca uno con dueños', async () => {
    const { service, calls } = make();
    const r = await service.cleanAccount('acc-A', NOW);
    assert.equal(r.orphaned, 2);
    const mark = calls.find((c) => c.op === 'updateMany')!;
    assert.equal(mark.where.status, 'PENDING');
    assert.deepEqual(mark.where.owners, { none: {} }, 'sólo los que no tienen NINGÚN dueño');
    assert.equal((mark.where.createdAt as { lt: Date }).lt.getTime(), NOW.getTime() - PENDING_TTL_MS);
    assert.equal(mark.data?.status, 'ORPHAN');
  });

  it('🔴 un ORPHAN sin dueños de más de 7 días se marca borrado y SÓLO entonces se borra el archivo físico', async () => {
    const { service, calls, removed } = make({ old: [{ id: 'f1', storageKey: `${'a'.repeat(64)}.png` }, { id: 'f2', storageKey: `${'b'.repeat(64)}.jpg` }] });
    const r = await service.cleanAccount('acc-A', NOW);
    assert.equal(r.deleted, 2);
    assert.deepEqual(removed, [`${'a'.repeat(64)}.png`, `${'b'.repeat(64)}.jpg`]);
    const find = calls.find((c) => c.op === 'findMany')!;
    assert.equal(find.where.status, 'ORPHAN');
    assert.deepEqual(find.where.owners, { none: {} });
    assert.equal((find.where.orphanedAt as { lt: Date }).lt.getTime(), NOW.getTime() - ORPHAN_TTL_MS);
    // la marca de borrado exige que SIGA huérfano y sin dueños (no pierde su contenido un archivo atado justo ahora)
    const marks = calls.filter((c) => c.op === 'updateMany' && c.data?.deletedAt);
    assert.equal(marks.length, 2);
    for (const m of marks) {
      assert.equal(m.where.status, 'ORPHAN');
      assert.deepEqual(m.where.owners, { none: {} });
    }
  });

  it('🔴 si la marca de borrado no se aplicó (se ató mientras tanto), el archivo físico NO se borra', async () => {
    const { service, removed } = make({ old: [{ id: 'f1', storageKey: `${'a'.repeat(64)}.png` }], markedCount: 0 });
    const r = await service.cleanAccount('acc-A', NOW);
    assert.equal(r.deleted, 0);
    assert.deepEqual(removed, []);
  });
});
