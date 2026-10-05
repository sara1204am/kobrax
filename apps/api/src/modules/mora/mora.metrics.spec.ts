import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { MoraService } from './mora.service';

const CREDIT = '11111111-1111-4111-8111-111111111111';
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
const day = (daysAgo: number) => iso(daysAgo).toISOString().slice(0, 10);

type EpisodeRow = {
  id: string;
  startedAt: Date;
  startedAtEstimated: boolean;
  endedAt: Date | null;
  endReason: string | null;
  startDaysPastDue: number | null;
  maxDaysPastDue: number | null;
  balanceAtStart: unknown;
  balanceAtEnd: unknown;
  source: string;
  reconstructed: boolean;
  createdAt: Date;
};
const episode = (over: Partial<EpisodeRow> = {}): EpisodeRow => ({
  id: 'e1',
  startedAt: d(day(10)),
  startedAtEstimated: false,
  endedAt: null,
  endReason: null,
  startDaysPastDue: 1,
  maxDaysPastDue: 10,
  balanceAtStart: '1000',
  balanceAtEnd: null,
  source: 'CALCULATED',
  reconstructed: false,
  createdAt: d(day(10)),
  ...over,
});

function make(opts: { visible?: boolean; episodes?: EpisodeRow[]; activities?: unknown[]; payments?: unknown[] } = {}) {
  const wheres: Record<string, unknown> = {};
  const tx = {
    $queryRaw: async () => (opts.visible === false ? [] : [{ id: CREDIT, client_id: 'cl1' }]),
    creditArrearEpisode: { findMany: async () => opts.episodes ?? [] },
    creditActivity: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        // Dos consultas distintas: las gestiones del crédito (por `creditId`) y los desenlaces de promesas (por `id`).
        if ('creditId' in a.where) {
          wheres.activities = a.where;
          return opts.activities ?? [];
        }
        return [];
      },
    },
    payment: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        wheres.payments = a.where;
        return opts.payments ?? [];
      },
    },
    agendaItem: { findMany: async () => [] },
  };
  const service = new MoraService(
    { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never,
    { accountId: 'acc', userId: 'u1', can: () => true } as never,
    { record: async () => undefined } as never,
    {} as never,
  );
  return { service, wheres };
}

describe('MoraService.metrics — las métricas de recuperación', () => {
  it('🔴 sobre un crédito que no puede ver: 404', async () => {
    const { service } = make({ visible: false });
    await assert.rejects(() => service.metrics(CREDIT), NotFoundException);
  });

  it('trae las gestiones del crédito (bitácora por crédito) y sus pagos', async () => {
    const { service, wheres } = make({ episodes: [episode()] });
    await service.metrics(CREDIT);
    assert.deepEqual(wheres.activities, { creditId: CREDIT });
    assert.deepEqual(wheres.payments, { creditId: CREDIT });
  });

  it('con una mora abierta mide desde su inicio: días hasta el primer contacto y la plata recuperada', async () => {
    const { service } = make({
      episodes: [episode({ startedAt: d(day(10)) })],
      activities: [
        { type: 'CALL', result: 'NO_ANSWER', createdAt: iso(8) },
        { type: 'CALL', result: 'CONTACTED', createdAt: iso(6) },
        { type: 'VISIT', result: 'NOT_FOUND', createdAt: iso(5) },
        { type: 'CALL', result: 'CONTACTED', createdAt: iso(40) }, // de una mora anterior: no cuenta
      ],
      payments: [
        { amount: '300.50', paymentDate: iso(2), channel: 'KOBRAX_COLLECTED' },
        { amount: '999', paymentDate: iso(2), channel: 'EXTERNAL_CONFIRMED' },
        { amount: '100', paymentDate: iso(60), channel: 'KOBRAX_COLLECTED' }, // anterior a esta mora
      ],
    });
    const { data } = await service.metrics(CREDIT);
    assert.equal(data!.window, 'EPISODE');
    assert.equal(data!.since, day(10));
    assert.equal(data!.balanceAtStart, 1000);
    assert.deepEqual(data!.activities, { total: 3, calls: 2, visits: 1, messages: 0 });
    assert.equal(data!.contacts, 1);
    assert.equal(data!.daysToFirstContact, 4);
    assert.equal(data!.daysToFirstVisit, 5);
    assert.equal(data!.recoveredAmount, 300.5);
    assert.equal(data!.recoveredAllTime, 400.5);
    assert.equal(data!.daysToFirstPayment, 8);
  });

  it('🔴 una mora que ya venía de antes de registrarse (importada ya vencida) lo avisa con los días que llevaba', async () => {
    // Empezó hace 100 días pero Kobrax abrió el episodio hoy.
    const { service } = make({ episodes: [episode({ startedAt: d(day(100)), createdAt: new Date() })] });
    const { data } = await service.metrics(CREDIT);
    assert.ok(data!.untrackedDays !== undefined && data!.untrackedDays >= 99 && data!.untrackedDays <= 101, String(data!.untrackedDays));
  });

  it('una mora registrada desde el principio no lleva el aviso', async () => {
    const { service } = make({ episodes: [episode({ startedAt: d(day(10)), createdAt: d(day(10)) })] });
    assert.equal((await service.metrics(CREDIT)).data!.untrackedDays, undefined);
  });

  it('un inicio estimado se informa como estimado', async () => {
    const { service } = make({ episodes: [episode({ startedAtEstimated: true })] });
    assert.equal((await service.metrics(CREDIT)).data!.sinceEstimated, true);
  });

  it('sin mora abierta: histórico, y sin «días hasta…»', async () => {
    const { service } = make({
      episodes: [episode({ endedAt: d(day(5)), endReason: 'PAID' })],
      activities: [{ type: 'CALL', result: 'CONTACTED', createdAt: iso(8) }],
    });
    const { data } = await service.metrics(CREDIT);
    assert.equal(data!.window, 'ALL');
    assert.equal(data!.daysToFirstContact, undefined);
    assert.equal(data!.activities.total, 1);
  });

  it('🔴 «cuánto tardó la última recuperación» ignora las que terminaron porque la fuente dejó de reportarlas', async () => {
    const { service } = make({
      episodes: [
        episode({ id: 'absent', startedAt: d(day(20)), endedAt: d(day(15)), endReason: 'SOURCE_ABSENT', createdAt: d(day(20)) }),
        episode({ id: 'current', startedAt: d(day(60)), endedAt: d(day(30)), endReason: 'CURRENT', createdAt: d(day(60)) }),
      ],
    });
    const { data } = await service.metrics(CREDIT);
    assert.equal(data!.lastRecoveredDays, 30);
  });

  it('una mora recuperada que no es la última no tapa a la más reciente', async () => {
    const { service } = make({
      episodes: [
        episode({ id: 'vieja', startedAt: d(day(100)), endedAt: d(day(70)), endReason: 'PAID', createdAt: d(day(100)) }),
        episode({ id: 'nueva', startedAt: d(day(40)), endedAt: d(day(30)), endReason: 'CURRENT', createdAt: d(day(40)) }),
      ],
    });
    assert.equal((await service.metrics(CREDIT)).data!.lastRecoveredDays, 10);
  });
});
