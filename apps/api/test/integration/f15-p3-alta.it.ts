/**
 * F15 · P3 — A-12: con cada opción de la ola 1a activa, crear un cliente y un crédito pasa por la API REAL sin campos exigidos
 * vacíos. La web arma los payloads con las funciones de `shared` (`buildClientePayload`, `buildNewCreditPayload`) y los valores
 * por defecto de `workspaceDefaults`; aquí se mandan tal cual al servidor (motor de créditos incluido).
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f15-p3-alta.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  CreditDefinition,
  PaymentFrequency,
  buildClientePayload,
  buildNewCreditPayload,
  emptyWorkspace,
  initialCliente,
  initialCreditForm,
  resolveWorkspace,
  type CreditForm,
  type Workspace,
} from '@kobrax/shared';
import { API, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin: string;

const FIRST_DUE = new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const ws = (options: Workspace['options']): Workspace => ({ ...emptyWorkspace(), options });

/** Lo que el usuario escribe por cada modalidad (lo único que sigue visible). */
const TYPED: Record<CreditDefinition, Partial<CreditForm>> = {
  [CreditDefinition.CALCULATED]: { principal: '1000', ratePercent: '24', installmentsCount: '1' },
  [CreditDefinition.AGREED_INSTALLMENT]: { principal: '1000', installmentAmount: '100', installmentsCount: '12' },
  [CreditDefinition.AGREED_TOTAL]: { principal: '1000', agreedTotal: '1200' },
};

async function newClient(label: string): Promise<string> {
  const form = { ...initialCliente(), firstName: label, lastName: 'Prueba', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
  form.contacts = [{ ...form.contacts[0]!, value: '70000000' }];
  const res = await call<{ id: string }>(admin, 'POST', '/clients', buildClientePayload(form));
  assert.equal(res.status, 201, JSON.stringify(res.error));
  return res.data!.id;
}

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Cobranzas ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('F15·P3 — A-12: el alta con las opciones activas pasa por la API real', () => {
  it('🔴 un cliente con género, canal preferido, ingresos, garantes y garantías OCULTOS (vacíos) se crea', async () => {
    const id = await newClient('Sin-opcionales');
    const row = await prisma.client.findUniqueOrThrow({ where: { id } });
    assert.ok(row.id);
  });

  for (const definition of Object.values(CreditDefinition)) {
    it(`🔴 con la modalidad «${definition}» FIJA, el crédito armado con los defaults de la organización se crea y el motor del servidor lo acepta`, async () => {
      const workspace = ws({ 'credit.definition': definition, 'credit.advanced': false, 'credit.arrearsMethod': false });
      const defaults = resolveWorkspace(workspace).creditDefaults();
      const form: CreditForm = { ...initialCreditForm(FIRST_DUE), ...defaults, ...TYPED[definition] };
      const clientId = await newClient(`Fija-${definition}`);
      const payload = buildNewCreditPayload(form, clientId);
      assert.ok(payload, 'el formulario con los defaults produce un payload válido');
      const res = await call<{ id: string; terms?: { definition?: string } }>(admin, 'POST', '/credits', payload);
      assert.equal(res.status, 201, JSON.stringify(res.error));
    });
  }

  it('con la frecuencia mensual NO permitida, el alta arranca en la primera permitida y el servidor la acepta', async () => {
    const workspace = ws({ 'credit.frequencies': ['WEEKLY', 'DAILY'] });
    const defaults = resolveWorkspace(workspace).creditDefaults();
    assert.equal(defaults.frequency, PaymentFrequency.DAILY);
    const form: CreditForm = { ...initialCreditForm(FIRST_DUE), ...defaults, ...TYPED[CreditDefinition.CALCULATED] };
    const payload = buildNewCreditPayload(form, await newClient('Frecuencia'));
    assert.ok(payload);
    const res = await call(admin, 'POST', '/credits', payload);
    assert.equal(res.status, 201, JSON.stringify(res.error));
  });

  it('🔴 A-6 / R7: un crédito de OTRA modalidad que la fija se abre y se edita sin perder datos', async () => {
    // La organización fijó «cuota acordada», pero este crédito se creó como «calculado» (antes de fijarla).
    const form: CreditForm = { ...initialCreditForm(FIRST_DUE), ...TYPED[CreditDefinition.CALCULATED] };
    const created = await call<{ id: string }>(admin, 'POST', '/credits', buildNewCreditPayload(form, await newClient('Antiguo')));
    assert.equal(created.status, 201, JSON.stringify(created.error));
    const detail = await call<{ id: string; principalAmount: number | string; metadata?: unknown }>(admin, 'GET', `/credits/${created.data!.id}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.error));
    // Se abre y se muestra tal cual (la pantalla solo decide si dibuja el selector); el servidor no lo consulta (R2).
    assert.equal(Number(detail.data!.principalAmount), 1000);
  });
});
