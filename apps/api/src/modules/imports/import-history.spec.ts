import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSummary } from './portfolio-import.service';

const base = {
  id: 'r1',
  createdAt: new Date('2026-09-30T15:18:00Z'),
  createdBy: 'u1',
  template: 'pdf-rows',
  scope: 'official:u9',
  externalSource: 'PSF',
  reportAsOf: new Date('2026-09-29T00:00:00Z'),
  advisorCode: 'CQE',
  creditsCreated: 4,
  creditsUpdated: 11,
  creditsReappeared: 2,
  creditsSetCurrent: 1,
  creditsAbsent: 1,
  errors: 3,
  rowsIgnored: 12,
  needsReview: 0,
  fileName: 'Reporte_Mora_20260929_CQE.pdf',
  fileSize: 9629,
  fileMime: 'application/pdf',
  fileKey: 'imports/abc.pdf',
  itemsComplete: true,
};

describe('runSummary — la corrida como la ve el historial', () => {
  it('🔴 «actualizadas» no cuenta dos veces a las que volvieron: van en su propia columna', () => {
    const s = runSummary(base, new Map([['u1', 'Owner Demo']]));
    assert.equal(s.counts.updated, 9);
    assert.equal(s.counts.reappeared, 2);
    assert.equal(s.counts.rejected, 3);
    assert.equal(s.reportDate, '2026-09-29');
    assert.deepEqual(s.createdBy, { id: 'u1', name: 'Owner Demo' });
    assert.deepEqual(s.file, { name: 'Reporte_Mora_20260929_CQE.pdf', size: 9629, mimeType: 'application/pdf' });
  });

  it('una corrida sin archivo guardado no ofrece uno', () => {
    const s = runSummary({ ...base, fileKey: null, fileName: null, itemsComplete: false }, new Map());
    assert.equal(s.file, undefined);
    assert.equal(s.createdBy, undefined, 'sin nombre resuelto no se inventa uno');
    assert.equal(s.itemsComplete, false);
  });
});
