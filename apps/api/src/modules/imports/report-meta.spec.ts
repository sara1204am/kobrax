import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readReportMeta } from './report-meta';

describe('readReportMeta — fecha de corte y asesor del encabezado (D8, D9)', () => {
  it('lee el encabezado de los reportes diarios de PSF', () => {
    const meta = readReportMeta([
      'FINANCIERA EJEMPLO S.A. — ENTIDAD SUPERVISADA POR ASFI',
      'Agencia: El Alto Asesor: CQE (Cod. 1377) Fecha de corte: 28/09/2026 (Lunes) Moneda: Bolivianos (BOB)',
    ]);
    assert.deepEqual(meta, { reportDate: '2026-09-28', advisorCode: 'CQE' });
  });

  it('también "Fecha de reporte" y sin dos puntos', () => {
    assert.equal(readReportMeta(['Cod. Asesor: CQE Fecha de reporte: 27/07/2026']).reportDate, '2026-07-27');
    assert.equal(readReportMeta(['Asesor CQE Fecha de corte 01/10/2026']).reportDate, '2026-10-01');
  });

  it('una fecha imposible no es una fecha de corte', () => {
    assert.equal(readReportMeta(['Fecha de corte: 31/02/2026']).reportDate, undefined);
  });

  it('sin encabezado reconocible no inventa nada', () => {
    assert.deepEqual(readReportMeta(['Nº Operación Cliente Saldo']), {});
  });
});
