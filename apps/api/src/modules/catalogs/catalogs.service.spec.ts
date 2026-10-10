import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogType } from '@prisma/client';
import { CatalogsService } from './catalogs.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { rows?: unknown[]; found?: unknown } = {}) {
  const calls = {
    listWhere: undefined as Record<string, unknown> | undefined,
    created: undefined as Record<string, unknown> | undefined,
    updated: undefined as Record<string, unknown> | undefined,
    audit: [] as string[],
  };
  const tx = {
    catalogItem: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        calls.listWhere = args.where;
        return opts.rows ?? [];
      },
      findFirst: async () => opts.found ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.created = args.data;
        return { id: 'cat1', ...args.data };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.updated = args.data;
        return { id: args.where.id, ...args.data };
      },
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A' };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const service = new CatalogsService(prisma as never, tenant as never, audit as never);
  return { service, calls };
}

describe('CatalogsService.list', () => {
  it('filtra por catálogo + activos + no borrados, ordenado', async () => {
    const { service, calls } = makeService({ rows: [{ code: 'CASH', label: 'Efectivo', sortOrder: 1, metadata: {} }] });
    const res = await service.list(CatalogType.PAYMENT_METHOD);
    assert.equal(calls.listWhere!.catalog, CatalogType.PAYMENT_METHOD);
    assert.equal(calls.listWhere!.isActive, true);
    assert.equal(calls.listWhere!.deletedAt, null);
    assert.equal(res.data![0]!.code, 'CASH');
  });
});

describe('CatalogsService.create/update/remove', () => {
  it('crea un ítem y audita CREATE', async () => {
    const { service, calls } = makeService();
    await service.create(CatalogType.BANK, { code: 'BNB', label: 'Banco Nacional' });
    assert.equal(calls.created!.catalog, CatalogType.BANK);
    assert.equal(calls.created!.code, 'BNB');
    assert.deepEqual(calls.audit, ['CREATE']);
  });

  it('update 404 si no existe (CATALOG_NOT_FOUND)', async () => {
    const { service } = makeService({ found: null });
    await rejectsWithCode(service.update(CatalogType.BANK, 'x', { label: 'y' }), 'CATALOG_NOT_FOUND');
  });

  it('remove hace soft-delete (deletedAt + isActive false) y audita DELETE', async () => {
    const { service, calls } = makeService({ found: { id: 'cat1' } });
    await service.remove(CatalogType.BANK, 'cat1');
    assert.ok(calls.updated!.deletedAt instanceof Date);
    assert.equal(calls.updated!.isActive, false);
    assert.deepEqual(calls.audit, ['DELETE']);
  });
});

describe('CatalogsService · F4/13', () => {
  it('🔴 update y remove buscan por catálogo además del id: un ítem de otro tipo no se toca desde la ruta equivocada', async () => {
    const wheres: Record<string, unknown>[] = [];
    const tx = {
      catalogItem: {
        findFirst: async (a: { where: Record<string, unknown> }) => {
          wheres.push(a.where);
          return null;
        },
      },
    };
    const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
    const service = new CatalogsService(prisma as never, { accountId: 'acc-A' } as never, { record: async () => undefined } as never);
    await rejectsWithCode(service.update(CatalogType.BANK, 'id1', { label: 'x' }), 'CATALOG_NOT_FOUND');
    await rejectsWithCode(service.remove(CatalogType.PRIORITY, 'id2'), 'CATALOG_NOT_FOUND');
    assert.equal(wheres[0]!.catalog, CatalogType.BANK);
    assert.equal(wheres[1]!.catalog, CatalogType.PRIORITY);
  });

  it('🔴 un rubro con una fuente de ingreso inventada se rechaza: el contenido decide qué motivos se ofrecen', async () => {
    const { service } = makeService();
    await rejectsWithCode(
      service.create(CatalogType.OCCUPATION, { code: 'X', label: 'X', metadata: { incomeSource: 'JEFE' } }),
      'CATALOG_METADATA_INVALID',
    );
  });

  it('un motivo con sus banderas se crea', async () => {
    const { service, calls } = makeService();
    await service.create(CatalogType.NO_PAYMENT_REASON, { code: 'LATE', label: 'Atrasado', metadata: { asksExpectedIncomeDate: true } });
    assert.deepEqual(calls.created!.metadata, { asksExpectedIncomeDate: true });
  });

  it('los catálogos anteriores siguen aceptando cualquier objeto', async () => {
    const { service, calls } = makeService();
    await service.create(CatalogType.WHATSAPP_TEMPLATE, { code: 'T', label: 'T', metadata: { body: 'Hola', otro: 1 } });
    assert.ok(calls.created);
  });

  it('🔴 al editar el contenido de un motivo también se valida', async () => {
    const { service } = makeService({ found: { id: 'c1' } });
    await rejectsWithCode(
      service.update(CatalogType.NO_PAYMENT_REASON, 'c1', { metadata: { sensitive: 'si' } }),
      'CATALOG_METADATA_INVALID',
    );
  });
});
