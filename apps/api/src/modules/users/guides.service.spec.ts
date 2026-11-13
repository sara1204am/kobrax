import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGuideState } from '@kobrax/shared';
import { GuidesService } from './guides.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

type Key = { accountId_userId: { accountId: string; userId: string } };
type Row = { accountId: string; userId: string; state: unknown };

/** Un fake de `user_guide_states` con su clave única (cuenta + persona), como la tabla real. */
function make(userId: string | undefined | null = 'u1', accountId = 'acc-A', rows: Row[] = []) {
  const find = (w: Key) =>
    rows.find(
      (r) => r.accountId === w.accountId_userId.accountId && r.userId === w.accountId_userId.userId,
    );
  const tx = {
    userGuideState: {
      findUnique: async (a: { where: Key }) => find(a.where) ?? null,
      upsert: async (a: { where: Key; create: Row; update: { state: unknown } }) => {
        const found = find(a.where);
        if (found) found.state = a.update.state;
        else rows.push({ ...a.create });
        return found ?? a.create;
      },
    },
  };
  const prisma = {
    withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return {
    service: new GuidesService(
      prisma as never,
      { accountId, userId: userId ?? undefined } as never,
    ),
    rows,
  };
}

const seen = { ...emptyGuideState(), screens: { 'screen.portfolio': 'seen' }, welcomeSeen: true };

describe('GuidesService (F15 · P6)', () => {
  it('sin fila devuelve el estado vacío', async () => {
    assert.deepEqual(await make().service.get(), emptyGuideState());
  });

  it('guarda y vuelve a leer lo mismo', async () => {
    const { service } = make();
    await service.put(seen);
    assert.deepEqual(await service.get(), seen);
  });

  it('una segunda escritura reemplaza la fila, no crea otra (una por persona y organización)', async () => {
    const { service, rows } = make();
    await service.put(seen);
    await service.put({ ...seen, welcomeSeen: false });
    assert.equal(rows.length, 1);
    assert.equal((await service.get()).welcomeSeen, false);
  });

  it('🔴 cada persona solo ve SU fila: otra persona de la misma cuenta lee vacío', async () => {
    const rows: Row[] = [];
    await make('u1', 'acc-A', rows).service.put(seen);
    assert.deepEqual(await make('u2', 'acc-A', rows).service.get(), emptyGuideState());
  });

  it('🔴 la misma persona en OTRA organización tiene su propio estado', async () => {
    const rows: Row[] = [];
    await make('u1', 'acc-A', rows).service.put(seen);
    assert.deepEqual(await make('u1', 'acc-B', rows).service.get(), emptyGuideState());
    await make('u1', 'acc-B', rows).service.put(emptyGuideState());
    assert.equal(rows.length, 2);
  });

  it('🔴 sin persona en la sesión no lee ni escribe: no existe una fila comodín compartida', async () => {
    const rows: Row[] = [];
    const anon = make(null, 'acc-A', rows).service;
    await rejectsWithCode(anon.get(), 'GUIDE_STATE_NO_USER');
    await rejectsWithCode(anon.put(seen), 'GUIDE_STATE_NO_USER');
    assert.equal(rows.length, 0);
  });

  const invalid: [string, unknown][] = [
    ['no es un objeto', 5],
    ['clave de pantalla inválida', { ...emptyGuideState(), screens: { 'a b': 'seen' } }],
    ['valor inválido', { ...emptyGuideState(), screens: { ok: 'raro' } }],
    [
      'recorrido inválido',
      { ...emptyGuideState(), tour: { status: 'x', step: 0, catalogVersion: 0 } },
    ],
    ['documento enorme', { ...emptyGuideState(), pad: 'x'.repeat(5000) }],
  ];
  for (const [name, body] of invalid) {
    it(`rechaza con 422 y NO guarda: ${name}`, async () => {
      const { service, rows } = make();
      await rejectsWithCode(service.put(body), 'GUIDE_STATE_INVALID');
      assert.equal(rows.length, 0);
    });
  }
});
