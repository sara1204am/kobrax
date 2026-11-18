import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type Redis from 'ioredis';
import { startJob } from './start-job';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeRedis = (impl: () => Promise<string | null>) => ({ set: impl }) as unknown as Redis;

describe('startJob', () => {
  it('sin Redis corre en cada ciclo', async () => {
    let n = 0;
    const t = startJob({ name: 't1', intervalMs: 10, run: async () => void n++ });
    await wait(55);
    clearInterval(t);
    assert.ok(n >= 3, `corrió ${n} veces`);
  });

  it('si otro tiene el candado (SET NX devuelve null) se salta el ciclo', async () => {
    let n = 0;
    const t = startJob({ name: 't2', intervalMs: 10, run: async () => void n++, redis: fakeRedis(async () => null) });
    await wait(40);
    clearInterval(t);
    assert.equal(n, 0);
  });

  it('si Redis falla, corre igual', async () => {
    let n = 0;
    const t = startJob({
      name: 't3',
      intervalMs: 10,
      run: async () => void n++,
      redis: fakeRedis(async () => {
        throw new Error('down');
      }),
    });
    await wait(40);
    clearInterval(t);
    assert.ok(n >= 1);
  });

  it('no se solapa consigo mismo y un fallo no lo detiene', async () => {
    let active = 0;
    let max = 0;
    let calls = 0;
    const t = startJob({
      name: 't4',
      intervalMs: 5,
      run: async () => {
        calls++;
        active++;
        max = Math.max(max, active);
        await wait(25);
        active--;
        if (calls === 1) throw new Error('boom');
      },
    });
    await wait(120);
    clearInterval(t);
    assert.equal(max, 1);
    assert.ok(calls >= 2, 'siguió corriendo tras el fallo');
  });
});
