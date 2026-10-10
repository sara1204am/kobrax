/**
 * F4/13 · E2 por las vías reales: API compilada y base recreada desde cero. Lo que los unitarios no pueden afirmar:
 *   - que el perfil de cobro de una ubicación **se guarde en el alta** (antes el alta atómica lo descartaba) y se
 *     **devuelva** al leer el cliente (antes ningún endpoint lo devolvía);
 *   - que se pueda **corregir** con el PATCH de la ubicación y **borrar** con `null`;
 *   - que un perfil inválido se rechace con 400 y no deje un cliente a medias;
 *   - que el canal preferido tenga tope de largo.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { call, freshDatabase, login, startApi, stopApi } from './harness';

interface Loc {
  id: string;
  address: string | null;
  zone?: string;
  visitSchedule?: Record<string, unknown> | null;
}
interface ClientOut {
  id: string;
  preferredContactChannel?: string;
  locations?: Loc[];
}

let token: string;
const PERFIL = { modality: 'PICK_UP', frequency: 'DAILY', window: { from: '08:00', to: '10:00' }, days: [1, 2, 3, 4, 5, 6], handoverBy: 'EMPLOYEE', note: 'Tocar el portón verde' };

const nuevo = (extra: Record<string, unknown> = {}) => ({
  clientType: 'PERSON',
  firstName: 'Ana',
  lastName: `Quispe-${randomUUID().slice(0, 6)}`,
  contacts: [{ contactType: 'PHONE', value: '70000001', isPrimary: true }],
  ...extra,
});

before(async () => {
  await freshDatabase();
  await startApi();
  token = await login('manager@kobrax.demo');
});

after(() => stopApi());

const leer = async (id: string): Promise<ClientOut> => {
  const r = await call<ClientOut>(token, 'GET', `/clients/${id}?reveal=true`);
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data!;
};

describe('E2 · perfil de cobro de una ubicación', () => {
  let clientId: string;
  let locationId: string;

  it('🔴 el alta lo guarda y la lectura lo devuelve (antes se perdía en el alta y no se leía)', async () => {
    const r = await call<ClientOut>(token, 'POST', '/clients', nuevo({ preferredContactChannel: 'WHATSAPP', locations: [{ locationType: 'WORK', address: 'Mercado Rodríguez, puesto 12', visitSchedule: PERFIL }] }));
    assert.equal(r.status, 201, JSON.stringify(r.error));
    clientId = r.data!.id;
    const c = await leer(clientId);
    assert.equal(c.preferredContactChannel, 'WHATSAPP');
    assert.equal(c.locations!.length, 1);
    assert.deepEqual(c.locations![0]!.visitSchedule, PERFIL);
    locationId = c.locations![0]!.id;
  });

  it('se corrige con el PATCH de la ubicación (antes la edición no lo aceptaba)', async () => {
    const r = await call(token, 'PATCH', `/clients/${clientId}/locations/${locationId}`, { visitSchedule: { modality: 'AT_BUSINESS', frequency: 'WEEKLY', days: [5] } });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const c = await leer(clientId);
    assert.deepEqual(c.locations![0]!.visitSchedule, { modality: 'AT_BUSINESS', frequency: 'WEEKLY', days: [5] });
  });

  it('editar otro campo no toca el perfil', async () => {
    await call(token, 'PATCH', `/clients/${clientId}/locations/${locationId}`, { zone: 'Centro' });
    const c = await leer(clientId);
    assert.equal(c.locations![0]!.zone, 'Centro');
    assert.deepEqual(c.locations![0]!.visitSchedule, { modality: 'AT_BUSINESS', frequency: 'WEEKLY', days: [5] });
  });

  it('🔴 null lo borra', async () => {
    const r = await call(token, 'PATCH', `/clients/${clientId}/locations/${locationId}`, { visitSchedule: null });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const c = await leer(clientId);
    assert.ok(c.locations![0]!.visitSchedule == null);
  });

  it('🔴 una franja al revés se rechaza con 400 y no deja un cliente a medias', async () => {
    const apellido = `Rechazado-${randomUUID().slice(0, 6)}`;
    const r = await call(token, 'POST', '/clients', nuevo({ lastName: apellido, locations: [{ address: 'X', visitSchedule: { window: { from: '18:00', to: '08:00' } } }] }));
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, 'CLIENT_COLLECTION_PROFILE_INVALID');
    const lista = await call<{ lastName?: string }[]>(token, 'GET', `/clients?search=${apellido}`);
    assert.equal((lista.data ?? []).filter((c) => c.lastName === apellido).length, 0);
  });

  it('un campo inventado se rechaza al agregar una ubicación', async () => {
    const r = await call(token, 'POST', `/clients/${clientId}/locations`, { address: 'Y', visitSchedule: { color: 'rojo' } });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, 'CLIENT_COLLECTION_PROFILE_INVALID');
  });

  it('el canal preferido tiene tope de largo', async () => {
    const r = await call(token, 'PATCH', `/clients/${clientId}`, { preferredContactChannel: 'x'.repeat(41) });
    assert.equal(r.status, 400);
  });

  it('un cliente sin perfil sigue funcionando', async () => {
    const r = await call<ClientOut>(token, 'POST', '/clients', nuevo({ locations: [{ address: 'Calle 1' }] }));
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const c = await leer(r.data!.id);
    assert.ok(c.locations![0]!.visitSchedule == null);
  });
});
