import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overdueFromSchedule, serializeMoraCredit, type MoraCreditRow } from './mora.serializer';

const NOW = new Date('2026-10-01T12:00:00Z');

function row(over: Partial<MoraCreditRow> = {}): MoraCreditRow {
  return {
    id: 'cr1',
    code: '302-222-9734',
    clientId: 'cl1',
    currency: 'BOB',
    outstandingBalance: '7011.42',
    principalAmount: '10000',
    daysPastDue: 45,
    metadata: {},
    origin: 'MANUAL',
    externalSource: null,
    syncStatus: null,
    reportedAsOf: null,
    branchId: null,
    branch: null,
    client: { firstName: 'Fernando', lastName: 'Blanco Choque', businessName: null },
    installments: [],
    cases: [],
    payments: [],
    ...over,
  };
}
const inst = (n: number, due: string, amount: number, paid: number, status: string) => ({
  number: n,
  dueDate: new Date(`${due}T00:00:00Z`),
  amount,
  paidAmount: paid,
  status,
});
const opts = { now: NOW, hasActivePromise: false };

describe('overdueFromSchedule', () => {
  it('suma lo que falta de las cuotas ya vencidas y no pagadas', () => {
    const sum = overdueFromSchedule(
      [inst(1, '2026-08-01', 100, 100, 'PAID'), inst(2, '2026-09-01', 100, 40, 'PARTIAL'), inst(3, '2026-09-20', 100, 0, 'OVERDUE'), inst(4, '2026-10-20', 100, 0, 'PENDING')],
      NOW,
    );
    assert.equal(sum, 160);
  });
  it('una cuota que vence hoy todavía no está vencida', () => {
    assert.equal(overdueFromSchedule([inst(1, '2026-10-01', 100, 0, 'PENDING')], NOW), 0);
  });
});

describe('serializeMoraCredit — un crédito, un registro', () => {
  it('propio con cronograma y mora calculada: el vencido sale de las cuotas, no del saldo', () => {
    const r = serializeMoraCredit(
      row({ installments: [inst(1, '2026-09-01', 100, 0, 'OVERDUE'), inst(2, '2026-11-01', 100, 0, 'PENDING')] }),
      opts,
    );
    assert.equal(r.balance, 7011.42);
    assert.equal(r.overdueAmount, 100);
    assert.equal(r.overdueSource, 'SCHEDULE');
    assert.equal(r.arrearsSource, 'CALCULATED');
    assert.equal(r.daysPastDue, 45);
    assert.equal(r.clientName, 'Fernando Blanco Choque');
  });

  it('propio sin cronograma: el monto vencido NO se inventa', () => {
    const r = serializeMoraCredit(row({ metadata: { installmentAmount: 300, nextDueDate: '2026-09-15' } }), opts);
    assert.equal(r.overdueAmount, undefined);
    assert.equal(r.installmentAmount, 300);
    assert.equal(r.nextDueDate, '2026-09-15');
  });

  it('mora marcada a mano: sin monto vencido afirmable, con inicio declarado', () => {
    const r = serializeMoraCredit(
      row({ metadata: { moraSince: '2026-08-20' }, installments: [inst(1, '2026-09-01', 100, 0, 'OVERDUE')] }),
      opts,
    );
    assert.equal(r.arrearsSource, 'MANUAL');
    assert.equal(r.overdueAmount, undefined);
    assert.equal(r.moraSince, '2026-08-20');
  });

  it('importado: el vencido y el último pago son lo que reportó el archivo; el inicio de mora no se estima', () => {
    const r = serializeMoraCredit(
      row({
        origin: 'IMPORT',
        externalSource: 'PSF',
        syncStatus: 'PRESENT',
        reportedAsOf: new Date('2026-10-01T00:00:00Z'),
        metadata: { origin: 'import', pastDueAmount: 820.5, lastPaymentDate: '2026-07-10', reportedStatus: 'Ejecución' },
      }),
      opts,
    );
    assert.equal(r.arrearsSource, 'IMPORTED');
    assert.equal(r.overdueAmount, 820.5);
    assert.equal(r.overdueSource, 'REPORTED');
    assert.equal(r.lastPaymentAt, '2026-07-10');
    assert.equal(r.moraSince, undefined);
    assert.equal(r.reportedStatus, 'Ejecución');
    assert.equal(r.externalSource, 'PSF');
    assert.equal(r.reportedStale, false);
  });

  it('importado que no trajo el vencido ni el saldo: llega sin dato, nunca 0', () => {
    const r = serializeMoraCredit(
      row({ origin: 'IMPORT', externalSource: 'PSF', syncStatus: 'PRESENT', metadata: { origin: 'import', importMissing: ['outstandingBalance', 'principalAmount'] }, outstandingBalance: '0', principalAmount: '0' }),
      opts,
    );
    assert.equal(r.balance, undefined);
    assert.equal(r.principalAmount, undefined);
    assert.equal(r.overdueAmount, undefined);
    assert.equal(r.lastPaymentAt, undefined);
  });

  it('importado con reporte viejo se marca desactualizado (D9)', () => {
    const r = serializeMoraCredit(
      row({ origin: 'IMPORT', externalSource: 'PSF', syncStatus: 'PRESENT', reportedAsOf: new Date('2026-09-20T00:00:00Z'), metadata: { origin: 'import' } }),
      { ...opts, staleAfterDays: 2 },
    );
    assert.equal(r.reportedStale, true);
  });

  it('último pago: el mayor entre lo reportado y lo cobrado en Kobrax', () => {
    const r = serializeMoraCredit(
      row({ origin: 'IMPORT', externalSource: 'PSF', syncStatus: 'PRESENT', metadata: { origin: 'import', lastPaymentDate: '2026-07-10' }, payments: [{ paymentDate: new Date('2026-09-15T10:00:00Z') }] }),
      opts,
    );
    assert.equal(r.lastPaymentAt, '2026-09-15');
  });

  it('crédito sin caso: aparece, sin caso ni prioridad', () => {
    const r = serializeMoraCredit(row(), opts);
    assert.equal(r.case, undefined);
    assert.equal(r.creditId, 'cr1');
  });

  it('con caso abierto: estado, prioridad fijada, SLA vencido y última gestión', () => {
    const r = serializeMoraCredit(
      row({
        cases: [
          {
            id: 'case1',
            status: 'ACTIVE',
            priority: 'CRITICAL',
            priorityPinnedAt: new Date('2026-09-01T00:00:00Z'),
            assigneeId: 'u1',
            slaDueAt: new Date('2026-09-30T00:00:00Z'),
            lastActionAt: new Date('2026-09-28T10:00:00Z'),
            activities: [{ type: 'VISIT', result: 'NOT_FOUND' }],
          },
        ],
      }),
      { ...opts, hasActivePromise: true },
    );
    assert.equal(r.case?.id, 'case1');
    assert.equal(r.case?.priority, 'CRITICAL');
    assert.equal(r.case?.priorityPinned, true);
    assert.equal(r.case?.isOverdue, true);
    assert.equal(r.case?.assigneeId, 'u1');
    assert.equal(r.lastActivityType, 'VISIT');
    assert.equal(r.lastActivityResult, 'NOT_FOUND');
    assert.equal(r.hasActivePromise, true);
  });

  it('oficina: id y nombre', () => {
    const r = serializeMoraCredit(row({ branchId: 'b1', branch: { name: 'Centro' } }), opts);
    assert.equal(r.branchId, 'b1');
    assert.equal(r.branchName, 'Centro');
  });
});
