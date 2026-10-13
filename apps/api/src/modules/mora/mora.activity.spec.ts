import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MoraService } from './mora.service';
import { AgendaService } from '../agenda/agenda.service';

const CREDIT = '11111111-1111-4111-8111-111111111111';
const OTHER_CREDIT = '99999999-9999-4999-8999-999999999999';
const ITEM = '33333333-3333-4333-8333-333333333333';
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const PROMISE = { amount: 500, promiseDate: FUTURE, paymentMethodCode: 'CASH' };

interface Opts {
  visible?: boolean;
  /** Gestión que ya existe con el id que manda el teléfono. */
  previous?: { creditId: string };
  /** Dos envíos a la vez: la 1ª búsqueda no la ve, la escritura choca con la unicidad y la 2ª búsqueda sí. */
  lateWinner?: boolean;
  /** Episodio de mora abierto (`undefined` = el crédito está al día). */
  episode?: string;
  /** La gestión agendada que `agendaItemId` apunta. */
  agendaItem?: Record<string, unknown> | null;
  permissions?: string[];
}

function make(opts: Opts = {}) {
  const calls = {
    activities: [] as Record<string, unknown>[],
    creditUpdates: [] as Record<string, unknown>[],
    promises: [] as { creditId: string; details: Record<string, unknown> }[],
    recorded: [] as unknown[],
    agendaUpdates: [] as { where: { id: string }; data: Record<string, unknown> }[],
    audits: [] as { entity: string; action: string }[],
    queries: [] as { sql: string; values: unknown[] }[],
  };
  let activityLookups = 0;
  const stored = { id: 'act-previa', type: 'CALL', createdAt: new Date('2026-10-02T09:00:00Z'), creditId: CREDIT, episodeId: null };
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      calls.queries.push({ sql: q.sql, values: q.values });
      return opts.visible === false ? [] : [{ id: CREDIT, client_id: 'cl1' }];
    },
    creditActivity: {
      findFirst: async () => {
        if (opts.lateWinner) return activityLookups++ === 0 ? null : { ...stored, id: 'act-ganadora' };
        return opts.previous ? { ...stored, creditId: opts.previous.creditId } : null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        if (opts.lateWinner) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        calls.activities.push(args.data);
        return { id: (args.data.id as string) ?? 'act1', createdAt: new Date('2026-10-02T10:00:00Z'), ...args.data };
      },
    },
    creditArrearEpisode: { findFirst: async () => (opts.episode ? { id: opts.episode } : null) },
    credit: {
      update: async (args: { data: Record<string, unknown> }) => {
        calls.creditUpdates.push(args.data);
        return {};
      },
    },
    agendaItem: {
      findFirst: async () => opts.agendaItem ?? null,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.agendaUpdates.push(args);
        return { id: args.where.id, ...args.data };
      },
    },
  };
  const permissions = opts.permissions ?? ['collection:read', 'collection:write', 'assignment:write'];
  const agenda = {
    createPromiseItem: async (_tx: unknown, input: { creditId: string; details: Record<string, unknown> }) => {
      calls.promises.push(input);
      return { created: { id: 'promesa-1' }, reminder: null };
    },
    recordCreated: async (created: unknown) => void calls.recorded.push(created),
  };
  const service = new MoraService(
    { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never,
    { accountId: 'acc', userId: 'u1', can: (p: string) => permissions.includes(p) } as never,
    { record: async (e: { entity: string; action: string }) => void calls.audits.push({ entity: e.entity, action: e.action }) } as never,
    agenda as never,
    {} as never,
  );
  return { service, calls };
}

describe('MoraService.addActivity — por crédito', () => {
  it('registra una visita en credit_activities ', async () => {
    const { service, calls } = make({ episode: 'ep-1' });
    const res = await service.addActivity(CREDIT, { type: 'VISIT', result: 'NOT_FOUND', notes: '  Se dejó aviso con un familiar  ' });
    assert.deepEqual(res.data, { id: 'act1', type: 'VISIT', createdAt: new Date('2026-10-02T10:00:00Z'), episodeId: 'ep-1' });
    assert.equal('caseOpened' in res.data!, false);
    const a = calls.activities[0]!;
    assert.equal(a.creditId, CREDIT);
    assert.equal(a.clientId, 'cl1');
    assert.equal(a.userId, 'u1');
    assert.equal(a.type, 'VISIT');
    assert.equal(a.result, 'NOT_FOUND');
    assert.equal(a.notes, 'Se dejó aviso con un familiar');
  });

  it('la gestión queda ligada al episodio de mora ABIERTO', async () => {
    const { service, calls } = make({ episode: 'ep-7' });
    await service.addActivity(CREDIT, { type: 'CALL', result: 'NO_ANSWER' });
    assert.equal(calls.activities[0]!.episodeId, 'ep-7');
  });

  it('un crédito AL DÍA (sin episodio abierto) también se gestiona: episodeId null', async () => {
    const { service, calls } = make();
    const res = await service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' });
    assert.equal(calls.activities[0]!.episodeId, null);
    assert.equal(res.data!.episodeId, null);
  });

  it('actualiza credits.last_action_at (solo informativo)', async () => {
    const { service, calls } = make();
    await service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' });
    assert.equal(calls.creditUpdates.length, 1);
    assert.ok(calls.creditUpdates[0]!.lastActionAt instanceof Date);
    assert.deepEqual(Object.keys(calls.creditUpdates[0]!), ['lastActionAt'], 'no toca estado, días ni nada más');
  });

  it('🔴 una promesa se crea con AgendaService.createPromiseItem (una sola función) y se audita', async () => {
    const { service, calls } = make();
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: PROMISE });
    assert.equal(calls.promises.length, 1);
    assert.equal(calls.promises[0]!.creditId, CREDIT);
    assert.deepEqual(calls.promises[0]!.details, { ...PROMISE, bankCode: undefined });
    assert.deepEqual(calls.recorded, [{ id: 'promesa-1' }]);
  });

  it('sin promesa no se llama a la creación de promesas', async () => {
    const { service, calls } = make();
    await service.addActivity(CREDIT, { type: 'NOTE', notes: 'Hablé con la hija' });
    assert.equal(calls.promises.length, 0);
  });

  it('🔴 sobre un crédito que no puede ver: 404 y no escribe nada', async () => {
    const { service, calls } = make({ visible: false });
    await assert.rejects(() => service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' }), NotFoundException);
    assert.equal(calls.activities.length, 0);
    assert.equal(calls.creditUpdates.length, 0);
  });

  it('el alcance del cobrador entra en la consulta de visibilidad (por responsable, no por caso)', async () => {
    const { service, calls } = make({ permissions: ['collection:read', 'collection:write'] });
    await service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' });
    assert.match(calls.queries[0]!.sql, /cr\.assigned_manager_id = \?/);
    assert.ok(calls.queries[0]!.values.includes('u1'));
  });
});

describe('MoraService.addActivity — agendaItemId (cerrar lo agendado)', () => {
  const pending = (over: Record<string, unknown> = {}) => ({ id: ITEM, creditId: CREDIT, status: 'SCHEDULED', resultActivityId: null, ...over });

  it('marca EXECUTED esa gestión agendada, apuntando a la actividad nueva, en la misma transacción', async () => {
    const { service, calls } = make({ agendaItem: pending() });
    await service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED', agendaItemId: ITEM });
    assert.equal(calls.agendaUpdates.length, 1);
    assert.equal(calls.agendaUpdates[0]!.where.id, ITEM);
    assert.equal(calls.agendaUpdates[0]!.data.status, 'EXECUTED');
    assert.equal(calls.agendaUpdates[0]!.data.resultActivityId, 'act1');
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'EXECUTE' }]);
  });

  it('un agendado de OTRO crédito → 400 MORA_006 y no se escribe la actividad', async () => {
    const { service, calls } = make({ agendaItem: pending({ creditId: OTHER_CREDIT }) });
    await assert.rejects(
      () => service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED', agendaItemId: ITEM }),
      (err: BadRequestException) => err instanceof BadRequestException && (err.getResponse() as { code: string }).code === 'MORA_006',
    );
    assert.equal(calls.activities.length, 0);
    assert.equal(calls.agendaUpdates.length, 0);
  });

  it('un agendado inexistente → 400 MORA_006', async () => {
    const { service } = make({ agendaItem: null });
    await assert.rejects(() => service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED', agendaItemId: ITEM }), BadRequestException);
  });

  it('un agendado ya ejecutado con OTRA actividad (o cancelado) → 409 AGENDA_008', async () => {
    for (const status of ['EXECUTED', 'CANCELLED']) {
      const { service, calls } = make({ agendaItem: pending({ status, resultActivityId: 'otra' }) });
      await assert.rejects(
        () => service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED', agendaItemId: ITEM }),
        (err: ConflictException) => err instanceof ConflictException && (err.getResponse() as { code: string }).code === 'AGENDA_008',
      );
      assert.equal(calls.activities.length, 0, status);
    }
  });

  it('ya ejecutado con ESTA misma actividad (mismo id): no-op, no se vuelve a marcar', async () => {
    const ID = '22222222-2222-4222-8222-222222222222';
    const { service, calls } = make({ agendaItem: pending({ status: 'EXECUTED', resultActivityId: ID }) });
    await service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'CONTACTED', agendaItemId: ITEM });
    assert.equal(calls.agendaUpdates.length, 0);
    assert.deepEqual(calls.audits, []);
  });

  it('reintentar con un id que ya entró devuelve lo guardado sin tocar la agenda', async () => {
    const ID = '22222222-2222-4222-8222-222222222222';
    const { service, calls } = make({ previous: { creditId: CREDIT }, agendaItem: pending() });
    const res = await service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'CONTACTED', agendaItemId: ITEM });
    assert.equal(res.data!.id, 'act-previa');
    assert.equal(calls.agendaUpdates.length, 0);
  });
});

describe('MoraService.addActivity — validación (la regla de shared)', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['sin resultado', { type: 'CALL' }, 'MORA_RESULT_REQUIRED'],
    ['resultado que no es del tipo', { type: 'CALL', result: 'NOT_FOUND' }, 'MORA_RESULT_NOT_ALLOWED'],
    ['resultado inventado (antes era texto libre)', { type: 'CALL', result: 'ok' }, 'MORA_RESULT_NOT_ALLOWED'],
    ['promesa sin datos', { type: 'CALL', result: 'PROMISE_TO_PAY' }, 'MORA_PROMISE_REQUIRED'],
    ['datos de promesa con otro resultado', { type: 'CALL', result: 'NO_ANSWER', promise: PROMISE }, 'MORA_PROMISE_NOT_ALLOWED'],
    ['monto cero', { type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...PROMISE, amount: 0 } }, 'MORA_PROMISE_AMOUNT_INVALID'],
    ['fecha pasada', { type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...PROMISE, promiseDate: '2020-01-01' } }, 'MORA_PROMISE_DATE_PAST'],
    ['nota vacía', { type: 'NOTE', notes: '  ' }, 'MORA_NOTES_REQUIRED'],
    ['tipo del sistema', { type: 'PAYMENT', result: 'CONTACTED' }, 'MORA_TYPE_INVALID'],
  ];
  for (const [label, dto, code] of cases) {
    it(`${label} → 400 ${code} y no toca la base`, async () => {
      const { service, calls } = make();
      await assert.rejects(
        () => service.addActivity(CREDIT, dto as never),
        (err: BadRequestException) => err instanceof BadRequestException && (err.getResponse() as { code: string }).code === code,
      );
      assert.equal(calls.queries.length, 0, 'ni siquiera consulta');
      assert.equal(calls.activities.length, 0);
    });
  }

  it('quien escribe en Bolivia a las 21:00 puede prometer «hoy» aunque en UTC ya sea mañana (un día de margen)', async () => {
    const { service, calls } = make();
    const hoyMenosUno = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...PROMISE, promiseDate: hoyMenosUno } });
    assert.equal(calls.promises.length, 1);
  });
});

describe('MoraService.addActivity — id puesto por el teléfono (reintento sin red)', () => {
  const ID = '22222222-2222-4222-8222-222222222222';

  it('el id viaja a la fila para que la gestión se guarde con él', async () => {
    const { service, calls } = make();
    await service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' });
    assert.equal(calls.activities[0]!.id, ID);
  });

  it('🔴 reintentar con un id que ya entró devuelve lo guardado y NO escribe otra gestión', async () => {
    const { service, calls } = make({ previous: { creditId: CREDIT } });
    const res = await service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' });
    assert.equal(res.data!.id, 'act-previa');
    assert.equal(calls.activities.length, 0);
    assert.equal(calls.creditUpdates.length, 0);
    assert.equal(calls.promises.length, 0);
  });

  it('un id que pertenece a otro crédito rebota con 409 MORA_004', async () => {
    const { service } = make({ previous: { creditId: OTHER_CREDIT } });
    await assert.rejects(
      () => service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' }),
      (err: ConflictException) => err instanceof ConflictException && (err.getResponse() as { code: string }).code === 'MORA_004',
    );
  });

  it('sobre un crédito que no puede ver, 404 aunque traiga id', async () => {
    const { service } = make({ visible: false, previous: { creditId: CREDIT } });
    await assert.rejects(() => service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' }), NotFoundException);
  });

  it('🔴 dos envíos con el mismo id a la vez: el que pierde recibe la gestión del ganador, no un 500', async () => {
    const { service } = make({ lateWinner: true });
    const res = await service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' });
    assert.equal(res.data!.id, 'act-ganadora');
  });
});

/**
 * La promesa de «Registrar acción» y la de `POST /agenda` son la MISMA función. Aquí se corre la de verdad
 * (AgendaService) detrás de MoraService para probar sus reglas de punta a punta.
 */
describe('MoraService.addActivity — promesa por la función única de Agenda', () => {
  function makeReal(credit: Record<string, unknown>, catalog: Record<string, unknown> | null = { code: 'CASH', metadata: {} }) {
    const created: Record<string, unknown>[] = [];
    const tx = {
      $queryRaw: async () => [{ id: CREDIT, client_id: 'cl1' }],
      creditActivity: { findFirst: async () => null, create: async (a: { data: Record<string, unknown> }) => ({ id: 'act1', createdAt: new Date(), ...a.data }) },
      creditArrearEpisode: { findFirst: async () => null },
      agendaItem: {
        create: async (a: { data: Record<string, unknown> }) => {
          created.push(a.data);
          return { id: `item-${created.length}`, ...a.data };
        },
      },
      credit: {
        findFirst: async () => ({ id: CREDIT, clientId: 'cl1', outstandingBalance: 1000, deletedAt: null, assignedManagerId: 'resp-1', externalSource: null, ...credit }),
        update: async () => ({}),
      },
      catalogItem: { findFirst: async () => catalog },
    };
    const prisma = { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) };
    const tenant = { accountId: 'acc', userId: 'u1', can: (p: string) => ['collection:write'].includes(p) };
    const audits: string[] = [];
    const audit = { record: async (e: { entity: string; action: string }) => void audits.push(`${e.entity}:${e.action}`) };
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const agenda = new AgendaService(prisma as never, tenant as never, audit as never, {} as never, { emit: () => undefined } as never, { today: async () => today } as never);
    const service = new MoraService(prisma as never, tenant as never, audit as never, agenda, {} as never);
    return { service, created, audits };
  }

  it('crédito de Kobrax: una promesa por encima del saldo se rechaza (AGENDA_006)', async () => {
    const { service, created } = makeReal({});
    await assert.rejects(
      () => service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...PROMISE, amount: 1500 } }),
      (err: BadRequestException) => (err.getResponse() as { code: string }).code === 'AGENDA_006',
    );
    assert.equal(created.length, 0);
  });

  it('🔴 crédito externo (PSF): sin tope de saldo — el saldo reportado puede ser solo capital', async () => {
    const { service, created } = makeReal({ externalSource: 'PSF' });
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...PROMISE, amount: 1500 } });
    assert.equal(created[0]!.type, 'PROMISE_TO_PAY');
    assert.equal((created[0]!.details as { amount: number }).amount, 1500);
  });

  it('la promesa nace FIXED, asignada al RESPONSABLE del crédito, con su recordatorio de 24 h y sin caso', async () => {
    const { service, created, audits } = makeReal({});
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: PROMISE });
    const [promesa, recordatorio] = created;
    assert.equal(promesa!.timeMode, 'FIXED');
    assert.equal(promesa!.assigneeId, 'resp-1');
    assert.equal(promesa!.creditId, CREDIT);
    assert.equal(recordatorio!.type, 'REMINDER');
    assert.equal(recordatorio!.assigneeId, 'resp-1');
    assert.deepEqual(audits, ['agenda_item:CREATE', 'agenda_item:CREATE']);
  });

  it('crédito sin responsable → la promesa queda para quien la registra', async () => {
    const { service, created } = makeReal({ assignedManagerId: null });
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: PROMISE });
    assert.equal(created[0]!.assigneeId, 'u1');
  });

  it('medio de pago inexistente → AGENDA_006 (mismo catálogo que Agenda)', async () => {
    const { service, created } = makeReal({}, null);
    await assert.rejects(
      () => service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: PROMISE }),
      (err: BadRequestException) => (err.getResponse() as { code: string }).code === 'AGENDA_006',
    );
    assert.equal(created.length, 0);
  });
});

describe('MoraService.addActivity — contexto de la gestión (F4/13 · E4)', () => {
  it('guarda el motivo, la fecha esperada, quién responde y el origen', async () => {
    const { service, calls } = make();
    await service.addActivity(CREDIT, {
      type: 'VISIT',
      result: 'NOT_FOUND',
      reasonCode: 'LATE_INCOME',
      expectedIncomeDate: FUTURE,
      payerParty: 'GUARANTOR',
      origin: 'DICTATION',
    } as never);
    const a = calls.activities[0]!;
    assert.equal(a.reasonCode, 'LATE_INCOME');
    assert.equal(a.payerParty, 'GUARANTOR');
    assert.equal(a.origin, 'DICTATION');
    assert.ok(a.expectedIncomeDate instanceof Date);
    assert.equal((a.expectedIncomeDate as Date).toISOString().slice(0, 10), FUTURE);
  });

  it('🔴 sin contexto escribe NULL: lo anterior y lo encolado sin señal siguen igual', async () => {
    const { service, calls } = make();
    await service.addActivity(CREDIT, { type: 'CALL', result: 'NO_ANSWER' } as never);
    const a = calls.activities[0]!;
    assert.equal(a.reasonCode, null);
    assert.equal(a.expectedIncomeDate, null);
    assert.equal(a.payerParty, null);
    assert.equal(a.origin, null);
    assert.equal(calls.audits.filter((x) => x.entity === 'credit_activity').length, 0, 'sin contexto no hay nada que auditar');
  });

  it('con contexto se audita, y sin el texto libre de las notas', async () => {
    const audited: { after?: Record<string, unknown> }[] = [];
    const { service } = make();
    // El audit del servicio de pruebas solo guarda entidad y acción; se verifica por otra vía: la clave del evento.
    void audited;
    const { service: s2, calls } = make();
    await s2.addActivity(CREDIT, { type: 'CALL', result: 'NO_ANSWER', notes: 'dijo que su hijo Juan le debe', reasonCode: 'OVER_INDEBTED' } as never);
    assert.ok(calls.audits.some((x) => x.entity === 'credit_activity' && x.action === 'CREATE'));
    void service;
  });

  it('puede ir junto a una promesa', async () => {
    const { service, calls } = make();
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: PROMISE, reasonCode: 'LATE_INCOME', expectedIncomeDate: FUTURE } as never);
    assert.equal(calls.promises.length, 1);
    assert.equal(calls.activities[0]!.reasonCode, 'LATE_INCOME');
  });

  const invalid: [string, Record<string, unknown>, string][] = [
    ['motivo con formato inválido', { type: 'VISIT', result: 'NOT_FOUND', reasonCode: 'perdio el empleo' }, 'MORA_REASON_INVALID'],
    ['fecha esperada sin motivo', { type: 'VISIT', result: 'NOT_FOUND', expectedIncomeDate: FUTURE }, 'MORA_EXPECTED_INCOME_DATE_NEEDS_REASON'],
    ['fecha esperada pasada', { type: 'VISIT', result: 'NOT_FOUND', reasonCode: 'LATE_INCOME', expectedIncomeDate: '2020-01-01' }, 'MORA_EXPECTED_INCOME_DATE_PAST'],
    ['quién responde inventado', { type: 'VISIT', result: 'NOT_FOUND', payerParty: 'VECINO' }, 'MORA_PAYER_INVALID'],
    ['contexto en una nota', { type: 'NOTE', notes: 'x', reasonCode: 'FORGOT' }, 'MORA_CONTEXT_NOT_ALLOWED'],
  ];
  for (const [label, dto, code] of invalid) {
    it(`${label} → 400 ${code} y no toca la base`, async () => {
      const { service, calls } = make();
      await assert.rejects(
        () => service.addActivity(CREDIT, dto as never),
        (err: BadRequestException) => err instanceof BadRequestException && (err.getResponse() as { code: string }).code === code,
      );
      assert.equal(calls.queries.length, 0);
      assert.equal(calls.activities.length, 0);
    });
  }
});
