import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeStop } from './routes.serializer';

/** Cifrado falso: `enc:X` → `X`; cualquier otra cosa revienta (= legado en claro). */
const crypto = {
  decrypt: (v: string) => {
    if (!v.startsWith('enc:')) throw new Error('no es ciphertext');
    return v.slice(4);
  },
} as never;

const STOP = { id: 's1', clientId: 'cl1', caseId: 'ca1', sequenceOrder: 1, status: 'PENDING', visitedAt: null } as never;

function stop(client?: unknown) {
  return serializeStop({ ...(STOP as object), client } as never, crypto);
}

describe('serializeStop', () => {
  it('persona: nombre + apellido y la dirección de su casa, descifrada', () => {
    const s = stop({
      firstName: 'Ana',
      lastName: 'Ruiz',
      businessName: null,
      locations: [
        { locationType: 'WORK', address: 'enc:Mercado 4' },
        { locationType: 'HOME', address: 'enc:Av. Siempre Viva 742' },
      ],
    });
    assert.equal(s.clientName, 'Ana Ruiz');
    assert.equal(s.address, 'Av. Siempre Viva 742'); // HOME gana aunque no sea la primera
  });

  it('empresa: razón social', () => {
    const s = stop({ firstName: null, lastName: null, businessName: 'Ferretería Sur SRL', locations: [] });
    assert.equal(s.clientName, 'Ferretería Sur SRL');
  });

  it('sin ubicación cargada: la parada existe igual, sin dirección', () => {
    const s = stop({ firstName: 'Ana', lastName: 'Ruiz', businessName: null, locations: [] });
    assert.equal(s.address, undefined);
    assert.equal(s.sequenceOrder, 1);
  });

  it('sin HOME cae en la primera ubicación que haya', () => {
    const s = stop({
      firstName: 'Ana',
      lastName: null,
      businessName: null,
      locations: [{ locationType: 'WORK', address: 'enc:Mercado 4' }],
    });
    assert.equal(s.address, 'Mercado 4');
  });

  it('dirección legado en claro (sin cifrar) se devuelve tal cual', () => {
    const s = stop({ firstName: 'Ana', lastName: null, businessName: null, locations: [{ locationType: 'HOME', address: 'Calle Falsa 123' }] });
    assert.equal(s.address, 'Calle Falsa 123');
  });

  it('sin cliente incluido devuelve sólo ids (list / generate)', () => {
    const s = serializeStop(STOP);
    assert.equal(s.clientName, undefined);
    assert.equal(s.address, undefined);
    assert.equal(s.clientId, 'cl1');
  });

  // ── La mora de la tarjeta de RT-4 (S4) ─────────────────────────────────────

  it('la mora sale del crédito del caso de la parada', () => {
    const s = serializeStop(
      { ...(STOP as object), case: { credit: { outstandingBalance: '450.5', currency: 'BOB', daysPastDue: 45 } } } as never,
    );
    assert.equal(s.overdueAmount, 450.5); // Decimal de Prisma → number, como el resto del módulo
    assert.equal(s.currency, 'BOB');
    assert.equal(s.daysPastDue, 45);
  });

  it('una parada sin caso no trae mora, y no rompe', () => {
    const s = serializeStop({ ...(STOP as object), case: null } as never);
    assert.equal(s.overdueAmount, undefined);
    assert.equal(s.currency, undefined);
    assert.equal(s.daysPastDue, undefined);
  });

  it('un caso sin crédito tampoco trae mora', () => {
    const s = serializeStop({ ...(STOP as object), case: { credit: null } } as never);
    assert.equal(s.overdueAmount, undefined);
    assert.equal(s.daysPastDue, undefined);
  });

  // ── Cómo terminó la parada (S6) ────────────────────────────────────────────

  it('devuelve el resultado de la última visita', () => {
    // El query pide `take: 1` ordenado desc, así que la primera del array ES la última en el tiempo.
    const s = serializeStop({ ...(STOP as object), visits: [{ outcome: 'PROMISE_TO_PAY' }] } as never);
    assert.equal(s.lastOutcome, 'PROMISE_TO_PAY');
  });

  it('una parada sin visitar no tiene resultado (y no entra en ninguna categoría)', () => {
    assert.equal(serializeStop({ ...(STOP as object), visits: [] } as never).lastOutcome, undefined);
    assert.equal(serializeStop(STOP).lastOutcome, undefined);
  });

  it('mora en cero es un dato, no un hueco: se devuelve 0', () => {
    const s = serializeStop(
      { ...(STOP as object), case: { credit: { outstandingBalance: '0', currency: 'BOB', daysPastDue: 0 } } } as never,
    );
    assert.equal(s.overdueAmount, 0);
    assert.equal(s.daysPastDue, 0);
  });
});
