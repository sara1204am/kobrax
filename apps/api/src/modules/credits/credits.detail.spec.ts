import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ARREAR_CATEGORIES } from '@kobrax/shared';
import { CreditsService } from './credits.service';

/** F4/08 · la ficha del crédito (`GET /credits/:id`) trae situación, categoría y castigo. */

const CATS = DEFAULT_ARREAR_CATEGORIES.map((c, i) => ({ code: c.code, name: c.name, color: c.color, fromDays: c.fromDays, toDays: c.toDays, sortOrder: i }));

function make(opts: { credit?: Record<string, unknown>; openEpisodes?: number; categories?: typeof CATS } = {}) {
  const calls = { categoryQueries: 0 };
  const credit = { id: 'cr1', status: 'ACTIVE', daysPastDue: 0, metadata: {}, currency: 'BOB', principalAmount: '1000', outstandingBalance: '800', interestRate: '0', installmentsCount: 4, installments: [], arrears: [], _count: { payments: 0 }, writtenOffAt: null, writtenOffReason: null, ...opts.credit };
  const tx = {
    credit: { findFirst: async () => credit },
    creditArrearEpisode: { count: async () => opts.openEpisodes ?? 0 },
    arrearCategory: { findMany: async () => (calls.categoryQueries++, opts.categories ?? CATS) },
    account: { findUnique: async () => ({ currencyCode: 'BOB', configuration: {}, settings: {} }) },
  };
  const service = new CreditsService(
    { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as never,
    { accountId: 'acc', userId: 'u1', can: () => true } as never,
    { record: async () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, calls };
}

describe('CreditsService.findOne — situación, categoría y castigo (F4/08)', () => {
  it('en mora con episodio abierto: IN_ARREARS y su categoría por días (45 = B)', async () => {
    const { service, calls } = make({ credit: { daysPastDue: 45 }, openEpisodes: 1 });
    const out = await service.findOne('cr1');
    assert.equal(out.situation, 'IN_ARREARS');
    assert.equal(out.category?.code, 'B');
    assert.equal(out.daysPastDue, 45);
    assert.equal(out.writtenOff, false);
    assert.equal(calls.categoryQueries, 1, 'las categorías se cargan UNA vez');
  });

  it('bordes de categoría: 1 A, 30 A, 31 B, 60 B, 61 C, 5000 C (el último rango no tiene tope)', async () => {
    const expected: [number, string][] = [[1, 'A'], [30, 'A'], [31, 'B'], [60, 'B'], [61, 'C'], [5000, 'C']];
    for (const [days, code] of expected) {
      const { service } = make({ credit: { daysPastDue: days }, openEpisodes: 1 });
      assert.equal((await service.findOne('cr1')).category?.code, code, `${days} días`);
    }
  });

  it('al día (0 días): CURRENT y sin categoría', async () => {
    const { service } = make({ credit: { daysPastDue: 0 } });
    const out = await service.findOne('cr1');
    assert.equal(out.situation, 'CURRENT');
    assert.equal(out.category, undefined);
  });

  it('sin categorías configuradas: no hay categoría aunque esté en mora', async () => {
    const { service } = make({ credit: { daysPastDue: 40 }, openEpisodes: 1, categories: [] });
    const out = await service.findOne('cr1');
    assert.equal(out.situation, 'IN_ARREARS');
    assert.equal(out.category, undefined);
  });

  it('la situación sale del episodio, no de los días: 40 días sin episodio abierto = al día', async () => {
    const { service } = make({ credit: { daysPastDue: 40 }, openEpisodes: 0 });
    assert.equal((await service.findOne('cr1')).situation, 'CURRENT');
  });

  it('castigado: writtenOff, fecha y motivo; sigue en mora con su categoría (condición independiente)', async () => {
    const at = new Date('2026-09-20T10:00:00Z');
    const { service } = make({ credit: { daysPastDue: 240, writtenOffAt: at, writtenOffReason: 'Sin ubicar' }, openEpisodes: 1 });
    const out = await service.findOne('cr1');
    assert.equal(out.writtenOff, true);
    assert.equal(out.writtenOffAt, at);
    assert.equal(out.writtenOffReason, 'Sin ubicar');
    assert.equal(out.situation, 'IN_ARREARS');
    assert.equal(out.category?.code, 'C');
  });

});
