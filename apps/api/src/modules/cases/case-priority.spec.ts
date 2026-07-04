import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computePriority, priorityScore, slaDueAt } from './case-priority';

describe('computePriority', () => {
  it('saldo alto + mucha mora + riesgo alto → CRITICAL', () => {
    // 50000/1000=50 + 60 días + 30 (HIGH) = 140 ≥ 100
    assert.equal(computePriority({ outstandingBalance: 50000, daysPastDue: 60, riskSegment: 'HIGH' }), 'CRITICAL');
  });

  it('caso medio → HIGH/MEDIUM según umbrales', () => {
    // 6000/1000=6 + 35 + 30 = 71 → HIGH (≥60)
    assert.equal(computePriority({ outstandingBalance: 6000, daysPastDue: 35, riskSegment: 'HIGH' }), 'HIGH');
    // 2000/1000=2 + 30 + 0 = 32 → MEDIUM (≥30)
    assert.equal(computePriority({ outstandingBalance: 2000, daysPastDue: 30, riskSegment: 'LOW' }), 'MEDIUM');
  });

  it('saldo y mora bajos → LOW', () => {
    assert.equal(computePriority({ outstandingBalance: 500, daysPastDue: 3, riskSegment: 'LOW' }), 'LOW');
  });

  it('priorityScore es la suma ponderada saldo+días+riesgo', () => {
    assert.equal(priorityScore({ outstandingBalance: 1000, daysPastDue: 10, riskSegment: 'MEDIUM' }), 1 + 10 + 15);
  });
});

describe('slaDueAt', () => {
  it('CRITICAL vence en 24h, LOW en 120h', () => {
    const now = new Date('2026-06-18T00:00:00Z');
    assert.equal(slaDueAt('CRITICAL', now).toISOString(), '2026-06-19T00:00:00.000Z');
    assert.equal(slaDueAt('LOW', now).toISOString(), '2026-06-23T00:00:00.000Z');
  });
});
