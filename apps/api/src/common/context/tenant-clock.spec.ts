import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { civilMonthStartUTC, civilTodayUTC } from './tenant-clock.service';

/** El caso que motivó todo esto: 22:40 del 17 en La Paz ya es el 18 en UTC. */
const NOCHE_EN_LA_PAZ = new Date('2026-08-18T02:40:00.000Z');

describe('civilTodayUTC', () => {
  it('a las 22:40 en La Paz el día sigue siendo el 17, aunque en UTC ya sea el 18', () => {
    assert.equal(civilTodayUTC('America/La_Paz', NOCHE_EN_LA_PAZ).toISOString(), '2026-08-17T00:00:00.000Z');
    assert.equal(civilTodayUTC('UTC', NOCHE_EN_LA_PAZ).toISOString(), '2026-08-18T00:00:00.000Z');
  });

  it('del otro lado del mundo el día va adelantado, no atrasado', () => {
    assert.equal(civilTodayUTC('Asia/Tokyo', NOCHE_EN_LA_PAZ).toISOString(), '2026-08-18T00:00:00.000Z');
    assert.equal(
      civilTodayUTC('Pacific/Auckland', new Date('2026-08-17T13:00:00.000Z')).toISOString(),
      '2026-08-18T00:00:00.000Z',
    );
  });

  it('el resultado es siempre medianoche UTC: es el ancla con la que se guarda scheduledDate', () => {
    const d = civilTodayUTC('America/Mexico_City', NOCHE_EN_LA_PAZ);
    assert.equal(d.getUTCHours(), 0);
    assert.equal(d.getUTCMinutes(), 0);
  });

  it('una zona inválida guardada a mano no tumba la agenda: cae al día UTC', () => {
    assert.equal(civilTodayUTC('Marte/Olympus', NOCHE_EN_LA_PAZ).toISOString(), '2026-08-18T00:00:00.000Z');
  });
});

describe('civilMonthStartUTC (los contadores mensuales de L2)', () => {
  it('a las 22:40 del 31 en La Paz el mes sigue siendo agosto, aunque UTC ya esté en septiembre', () => {
    const nochevieja = new Date('2026-09-01T02:40:00.000Z');
    assert.equal(civilMonthStartUTC('America/La_Paz', nochevieja).toISOString(), '2026-08-01T00:00:00.000Z');
    assert.equal(civilMonthStartUTC('UTC', nochevieja).toISOString(), '2026-09-01T00:00:00.000Z');
  });

  it('a mitad de mes es el 1 de ese mes, medianoche UTC', () => {
    assert.equal(civilMonthStartUTC('America/La_Paz', NOCHE_EN_LA_PAZ).toISOString(), '2026-08-01T00:00:00.000Z');
  });
});
