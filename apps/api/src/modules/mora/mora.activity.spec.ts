import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MoraService } from './mora.service';

const CREDIT = '11111111-1111-4111-8111-111111111111';
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const PROMISE = { amount: 500, promiseDate: FUTURE, paymentMethodCode: 'CASH' };

function make(opts: { visible?: boolean; previous?: { creditId: string }; openCase?: string | null; raced?: string; createFails?: boolean; permissions?: string[] } = {}) {
  const calls = { created: [] as Record<string, unknown>[], added: [] as { caseId: string; dto: Record<string, unknown> }[], queries: [] as { sql: string; values: unknown[] }[] };
  let caseLookups = 0;
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      calls.queries.push({ sql: q.sql, values: q.values });
      return opts.visible === false ? [] : [{ id: CREDIT, client_id: 'cl1' }];
    },
    caseActivity: {
      findFirst: async () => (opts.previous ? { id: 'act-previa', type: 'CALL', createdAt: new Date('2026-10-02T09:00:00Z'), caseId: 'case-1', case: { creditId: opts.previous.creditId } } : null),
    },
    collectionCase: {
      findFirst: async () => {
        caseLookups++;
        // 1ª consulta: el caso abierto que hubiera. Las siguientes (carrera): el que abrió otra persona.
        if (caseLookups === 1) return opts.openCase ? { id: opts.openCase } : null;
        return opts.raced ? { id: opts.raced } : null;
      },
    },
  };
  const permissions = opts.permissions ?? ['case:read', 'case:write', 'case:assign'];
  const cases = {
    create: async (dto: Record<string, unknown>) => {
      calls.created.push(dto);
      if (opts.createFails) throw new Error('CASE_DUPLICATE');
      return { id: 'case-nuevo' };
    },
    addActivity: async (caseId: string, dto: Record<string, unknown>) => {
      calls.added.push({ caseId, dto });
      return { id: 'act1', type: dto.type, createdAt: new Date('2026-10-02T10:00:00Z') };
    },
  };
  const service = new MoraService(
    { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never,
    { accountId: 'acc', userId: 'u1', can: (p: string) => permissions.includes(p) } as never,
    { record: async () => undefined } as never,
    cases as never,
  );
  return { service, calls };
}

describe('MoraService.addActivity — gestión con resultado y promesa', () => {
  it('registra una visita con resultado sobre el caso abierto y delega en CasesService', async () => {
    const { service, calls } = make({ openCase: 'case-1' });
    const res = await service.addActivity(CREDIT, { type: 'VISIT', result: 'NOT_FOUND', notes: '  Se dejó aviso con un familiar  ' });
    assert.equal(res.data!.caseId, 'case-1');
    assert.equal(res.data!.caseOpened, false);
    assert.equal(calls.created.length, 0, 'no abre otro caso');
    assert.deepEqual(calls.added[0], { caseId: 'case-1', dto: { id: undefined, type: 'VISIT', result: 'NOT_FOUND', notes: 'Se dejó aviso con un familiar', promise: undefined } });
  });

  it('🔴 una promesa viaja entera a CasesService, que la vuelve un agenda_item', async () => {
    const { service, calls } = make({ openCase: 'case-1' });
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: PROMISE });
    assert.deepEqual(calls.added[0]!.dto.promise, PROMISE);
    assert.equal(calls.added[0]!.dto.result, 'PROMISE_TO_PAY');
  });

  it('🔴 si el crédito no tiene caso, lo abre antes de registrar la gestión', async () => {
    const { service, calls } = make({ openCase: null });
    const res = await service.addActivity(CREDIT, { type: 'CALL', result: 'NO_ANSWER' });
    assert.deepEqual(calls.created, [{ creditId: CREDIT }]);
    assert.equal(calls.added[0]!.caseId, 'case-nuevo');
    assert.equal(res.data!.caseOpened, true);
  });

  it('carrera: si otra persona abrió el caso a la vez, usa el suyo en vez de fallar', async () => {
    const { service, calls } = make({ openCase: null, createFails: true, raced: 'case-ajeno' });
    const res = await service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' });
    assert.equal(calls.added[0]!.caseId, 'case-ajeno');
    assert.equal(res.data!.caseOpened, false);
  });

  it('si la creación falla y no hay caso de nadie, el error sale (no se traga)', async () => {
    const { service } = make({ openCase: null, createFails: true });
    await assert.rejects(() => service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' }), /CASE_DUPLICATE/);
  });

  it('🔴 sobre un crédito que no puede ver: 404, no abre caso y no escribe', async () => {
    const { service, calls } = make({ visible: false });
    await assert.rejects(() => service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' }), NotFoundException);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.added.length, 0);
  });

  it('el alcance del cobrador entra en la consulta de visibilidad', async () => {
    const { service, calls } = make({ openCase: 'case-1', permissions: ['case:read', 'case:write'] });
    await service.addActivity(CREDIT, { type: 'CALL', result: 'CONTACTED' });
    assert.match(calls.queries[0]!.sql, /cc\.assignee_id = \?/);
    assert.ok(calls.queries[0]!.values.includes('u1'));
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
      const { service, calls } = make({ openCase: 'case-1' });
      await assert.rejects(
        () => service.addActivity(CREDIT, dto as never),
        (err: BadRequestException) => err instanceof BadRequestException && (err.getResponse() as { code: string }).code === code,
      );
      assert.equal(calls.queries.length, 0, 'ni siquiera consulta');
      assert.equal(calls.added.length, 0);
    });
  }

  it('quien escribe en Bolivia a las 21:00 puede prometer «hoy» aunque en UTC ya sea mañana (un día de margen)', async () => {
    const { service, calls } = make({ openCase: 'case-1' });
    const hoyMenosUno = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await service.addActivity(CREDIT, { type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...PROMISE, promiseDate: hoyMenosUno } });
    assert.equal(calls.added.length, 1);
  });
});

describe('MoraService.addActivity — id puesto por el teléfono (reintento sin red)', () => {
  const ID = '22222222-2222-4222-8222-222222222222';

  it('el id viaja a CasesService para que la gestión se guarde con él', async () => {
    const { service, calls } = make({ openCase: 'case-1' });
    await service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' });
    assert.equal(calls.added[0].dto.id, ID);
  });

  it('🔴 reintentar con un id que ya entró devuelve lo guardado y NO escribe otra gestión', async () => {
    const { service, calls } = make({ openCase: 'case-1', previous: { creditId: CREDIT } });
    const res = await service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' });
    assert.equal(res.data!.id, 'act-previa');
    assert.equal(calls.added.length, 0);
    assert.equal(calls.created.length, 0);
  });

  it('un id que pertenece a otro crédito rebota con 409', async () => {
    const { service } = make({ previous: { creditId: '99999999-9999-4999-8999-999999999999' } });
    await assert.rejects(() => service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' }), ConflictException);
  });

  it('sobre un crédito que no puede ver, 404 aunque traiga id', async () => {
    const { service } = make({ visible: false, previous: { creditId: CREDIT } });
    await assert.rejects(() => service.addActivity(CREDIT, { id: ID, type: 'CALL', result: 'NO_ANSWER' }), NotFoundException);
  });
});
