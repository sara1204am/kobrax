import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CryptoService } from '../../common/crypto/crypto.service';
import { serializeClient } from './clients.serializer';

/** F14 · F4: la proyección por categoría del serializador de clientes. */
const crypto = { decrypt: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'), encrypt: (v: string) => v } as unknown as CryptoService;

const now = new Date();
const base = {
  id: 'c1',
  clientType: 'PERSON',
  firstName: 'Ana',
  lastName: 'Ruiz',
  businessName: null,
  gender: null,
  nationalId: 'enc(8821903)',
  taxId: null,
  status: 'ACTIVE',
  linkReviewPending: false,
  preferredContactChannel: null,
  riskSegment: null,
  totalDebt: 0,
  maxDaysPastDue: 0,
  creditCount: 0,
  totalDebtExternal: 0,
  maxDaysPastDueExternal: 0,
  metadata: {},
  createdAt: now,
  updatedAt: now,
  contacts: [{ id: 'k1', contactType: 'PHONE', value: 'enc(78012345)', isPrimary: true, isVerified: false, notes: null }],
  locations: [{ id: 'l1', locationType: 'HOME', address: 'enc(Calle Sucre 123)', zone: 'Norte', latitude: -19.0, longitude: -65.2, referenceNotes: 'portón verde', photoUrls: ['/api/uploads/x.jpg'], riskLevel: null, visitSchedule: null }],
  relations: [{ id: 'r1', relatedName: 'Luis Ruiz', relationshipType: 'GUARANTOR', gender: null, isContactable: true, notes: null, contacts: [], locations: [] }],
  collaterals: [{ id: 'g1', type: 'MOTO', description: 'Moto roja', estimatedValue: 1000, currency: 'BOB', photoUrls: [] }],
  attachments: [{ id: 'a1', fileType: 'DOCUMENT', fileUrl: '/api/uploads/y.jpg', fileHash: null, encrypted: false, createdAt: now }],
  incomeProfile: { incomeSourceCode: 'X', occupationCode: null, incomeCycle: null, incomeDay: null, notes: null, origin: 'MANUAL', declaredAt: now },
} as never;

describe('serializeClient · proyección por categoría (F14 · F4)', () => {
  it('por omisión (sin opciones nuevas) todo sigue igual: nada se omite', () => {
    const r = serializeClient(base, { crypto, reveal: true });
    assert.equal(r.nationalId, '8821903');
    assert.ok(r.contacts && r.locations && r.relations && r.collaterals && r.attachments);
    assert.notEqual(r.incomeProfile, undefined);
  });

  it('🔴 sin contacto (VIEWER): no hay contactos, ubicaciones, personas relacionadas ni adjuntos; sin económicos, ni garantías ni ingresos', () => {
    const r = serializeClient(base, { crypto, reveal: false, contact: false, economic: false });
    assert.equal(r.contacts, undefined);
    assert.equal(r.locations, undefined);
    assert.equal(r.relations, undefined);
    assert.equal(r.attachments, undefined);
    assert.equal(r.collaterals, undefined);
    assert.equal(r.incomeProfile, undefined);
    assert.equal(r.firstName, 'Ana'); // el nombre lo ve todo el que ve al cliente
    assert.notEqual(r.nationalId, '8821903'); // y el documento sigue enmascarado
  });

  it('🔴 D-3: contactos en claro con el documento enmascarado (el supervisor en una pantalla de trabajo)', () => {
    const r = serializeClient(base, { crypto, reveal: true, revealDocument: false });
    assert.equal(r.contacts?.[0]?.value, '78012345');
    assert.equal(r.locations?.[0]?.address, 'Calle Sucre 123');
    assert.notEqual(r.nationalId, '8821903');
    assert.match(String(r.nationalId), /\*/);
  });

  it('sin revelar, contactos y direcciones salen enmascarados', () => {
    const r = serializeClient(base, { crypto, reveal: false });
    assert.notEqual(r.contacts?.[0]?.value, '78012345');
    assert.match(String(r.locations?.[0]?.address), /\*/);
  });
});
