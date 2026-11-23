/**
 * Mover varias notas (post-its) de la ficha de Mora a la vez, contra la API real.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/mora-notes-drag.it.ts
 *
 * Arrastrar una nota manda un PATCH con su nueva posición y `front: true` por cada gesto; con varias notas el panel manda muchos seguidos.
 * Esta prueba comprueba que la API los atiende todos (ninguno falla, ninguna conexión se corta) y que la API sigue viva después.
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { buildClientePayload, initialCliente } from '@kobrax/shared';
import { API, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi, legalAcceptance } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin: string;
let credit: string;

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Notas ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
  const form = { ...initialCliente(), firstName: `N${suffix}`, lastName: 'Notas', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
  form.contacts = [{ ...form.contacts[0]!, value: '70000000' }];
  const client = await call<{ id: string }>(admin, 'POST', '/clients', buildClientePayload(form));
  const firstDueDate = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const c = await call<{ id: string }>(admin, 'POST', '/credits', {
    clientId: client.data!.id,
    principalAmount: 1000,
    installmentAmount: 100,
    frequency: 'MONTHLY',
    nextDueDate: firstDueDate,
    installmentsCount: 12,
    terms: { definition: 'agreed_installment', principal: 1000, installmentAmount: 100, installmentsCount: 12, frequency: 'MONTHLY', firstDueDate },
  });
  credit = c.data!.id;
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('mover varias notas a la vez', () => {
  it('🔴 60 movimientos simultáneos de 5 notas: todos responden 200 y la API sigue viva', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await call<{ id: string }>(admin, 'POST', `/mora/${credit}/notes`, { body: `Nota ${i}`, kind: 'INFO', color: 'YELLOW', x: 10 + i * 20, y: 10 });
      assert.equal(r.status, 201, JSON.stringify(r.error));
      ids.push(r.data!.id);
    }

    const moves = Array.from({ length: 60 }, (_, i) =>
      call<{ id: string; x: number; y: number }>(admin, 'PATCH', `/mora/${credit}/notes/${ids[i % 5]}`, { x: 40 + i * 3, y: 25 + i * 2, front: true }),
    );
    const results = await Promise.all(moves);
    const bad = results.filter((r) => r.status !== 200);
    assert.equal(bad.length, 0, `fallaron ${bad.length}: ${JSON.stringify(bad.slice(0, 2).map((r) => [r.status, r.error]))}`);

    // La API sigue contestando y las 5 notas existen, ninguna borrada ni duplicada.
    const list = await call<{ id: string }[]>(admin, 'GET', `/mora/${credit}/notes`);
    assert.equal(list.status, 200);
    assert.equal(list.data!.length, 5);
  });

  it('muchas rondas seguidas (como arrastrar y soltar varias veces) tampoco cortan la conexión', async () => {
    const list = await call<{ id: string }[]>(admin, 'GET', `/mora/${credit}/notes`);
    const ids = list.data!.map((n) => n.id);
    for (let round = 0; round < 10; round++) {
      const rs = await Promise.all(ids.map((id, i) => call(admin, 'PATCH', `/mora/${credit}/notes/${id}`, { x: round * 7 + i, y: round * 5 + i, front: true })));
      assert.ok(rs.every((r) => r.status === 200), `ronda ${round}: ${JSON.stringify(rs.map((r) => r.status))}`);
    }
  });
});
