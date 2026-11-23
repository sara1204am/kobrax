/**
 * La fecha de una gestión de Mora, por las vías reales: API compilada y base real.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/mora-activity-date.it.ts
 *
 * Una gestión puede cargarse con la fecha de un día anterior —nunca de uno futuro—, queda fechada ese día, cuelga de la mora que cubría
 * ESA fecha (no de la de hoy) y «última gestión» no retrocede.
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { buildClientePayload, initialCliente } from '@kobrax/shared';
import { civilTodayUTC, timezoneOf } from '../../src/common/context/tenant-clock.service';
import { API, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi, legalAcceptance } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin: string;
let accountId: string;
let tz: string;

/** Un día civil de la empresa, relativo a hoy (`YYYY-MM-DD`). */
const day = (offset: number): string => new Date(civilTodayUTC(tz).getTime() + offset * 86_400_000).toISOString().slice(0, 10);

async function newOverdueCredit(daysLate: number): Promise<string> {
  const form = { ...initialCliente(), firstName: `G${suffix}`, lastName: 'Fecha', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
  form.contacts = [{ ...form.contacts[0]!, value: '70000000' }];
  const client = await call<{ id: string }>(admin, 'POST', '/clients', buildClientePayload(form));
  assert.equal(client.status, 201, JSON.stringify(client.error));
  const firstDueDate = day(-daysLate);
  const res = await call<{ id: string }>(admin, 'POST', '/credits', {
    clientId: client.data!.id,
    principalAmount: 1000,
    installmentAmount: 100,
    frequency: 'MONTHLY',
    nextDueDate: firstDueDate,
    installmentsCount: 12,
    terms: { definition: 'agreed_installment', principal: 1000, installmentAmount: 100, installmentsCount: 12, frequency: 'MONTHLY', firstDueDate },
  });
  assert.equal(res.status, 201, JSON.stringify(res.error));
  return res.data!.id;
}

const log = (creditId: string, body: Record<string, unknown>) =>
  call<{ id: string; createdAt: string; episodeId: string | null }>(admin, 'POST', `/mora/${creditId}/activities`, { type: 'CALL', result: 'NO_ANSWER', ...body });

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Fechas ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
  const account = await prisma.account.findFirstOrThrow({ where: { businessName: `Fechas ${suffix}` } });
  accountId = account.id;
  tz = timezoneOf(account);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('la fecha de la gestión', () => {
  it('🔴 una fecha FUTURA se rechaza (400) y no queda nada guardado', async () => {
    const credit = await newOverdueCredit(10);
    const r = await log(credit, { activityDate: day(1) });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, 'MORA_ACTIVITY_DATE_FUTURE');
    assert.equal(await prisma.creditActivity.count({ where: { creditId: credit } }), 0);
  });

  it('una fecha con formato o calendario inválido se rechaza', async () => {
    const credit = await newOverdueCredit(10);
    assert.equal((await log(credit, { activityDate: '2026-13-40' })).status, 400);
    assert.equal((await log(credit, { activityDate: 'ayer' })).status, 400);
    assert.equal(await prisma.creditActivity.count({ where: { creditId: credit } }), 0);
  });

  it('sin fecha, o con la de hoy, queda con la hora de ahora', async () => {
    const credit = await newOverdueCredit(10);
    const before = Date.now();
    const a = await log(credit, {});
    const b = await log(credit, { activityDate: day(0) });
    assert.equal(a.status, 201, JSON.stringify(a.error));
    assert.equal(b.status, 201, JSON.stringify(b.error));
    for (const r of [a, b]) assert.ok(new Date(r.data!.createdAt).getTime() >= before - 1000, 'es de ahora, no de un día anterior');
  });

  it('un día ANTERIOR queda fechado ese día, ligada a la mora que lo cubría, y «última gestión» no retrocede', async () => {
    const credit = await newOverdueCredit(10); // la mora empezó hace 10 días
    const recent = await log(credit, {}); // hoy: «última gestión» = ahora
    assert.equal(recent.status, 201);
    const lastBefore = (await prisma.credit.findUniqueOrThrow({ where: { id: credit } })).lastActionAt!;

    const past = await log(credit, { activityDate: day(-5), type: 'VISIT', result: 'NOT_FOUND', notes: 'Fui el lunes' });
    assert.equal(past.status, 201, JSON.stringify(past.error));
    const row = await prisma.creditActivity.findUniqueOrThrow({ where: { id: past.data!.id } });
    // El día civil de la empresa de la gestión es el pedido (el mediodía no se corre de día en ninguna zona).
    const civil = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(row.createdAt);
    assert.equal(civil, day(-5));
    const open = await prisma.creditArrearEpisode.findFirstOrThrow({ where: { creditId: credit, endedAt: null } });
    assert.equal(row.episodeId, open.id, 'cuelga de la mora que ya corría ese día');
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: credit } })).lastActionAt!.getTime(), lastBefore.getTime(), 'no retrocede');
  });

  it('una fecha ANTERIOR a que empezara la mora no cuelga de esa mora', async () => {
    const credit = await newOverdueCredit(3); // la mora empezó hace 3 días
    const r = await log(credit, { activityDate: day(-30), type: 'NOTE', result: undefined, notes: 'Contacto previo' });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const row = await prisma.creditActivity.findUniqueOrThrow({ where: { id: r.data!.id } });
    assert.equal(row.episodeId, null, 'esa fecha el crédito todavía estaba al día');
  });

  it('en el historial de la ficha aparece en su lugar cronológico (la más reciente primero)', async () => {
    const credit = await newOverdueCredit(10);
    await log(credit, { activityDate: day(-6), notes: 'vieja' });
    await log(credit, { activityDate: day(-2), notes: 'media' });
    await log(credit, { notes: 'hoy' });
    const ficha = await call<{ activities: { notes?: string; createdAt: string }[] }>(admin, 'GET', `/mora/${credit}`);
    assert.deepEqual(ficha.data!.activities.map((a) => a.notes), ['hoy', 'media', 'vieja']);
  });

  it('la gestión retroactiva queda auditada', async () => {
    const credit = await newOverdueCredit(10);
    const r = await log(credit, { activityDate: day(-2) });
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'credit_activity', entityId: r.data!.id } });
    assert.ok(audit, 'hay registro de auditoría');
    assert.equal((audit!.after as { activityDate?: string }).activityDate, day(-2));
    void accountId;
  });
});
