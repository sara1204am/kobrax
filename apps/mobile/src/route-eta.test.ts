import { clockAt, humanDistance, humanDuration, straightLine } from './route-eta';

describe('clockAt', () => {
  const salida = new Date(2026, 6, 29, 9, 30); // 09:30 AM

  it('la primera parada es la hora de salida', () => {
    expect(clockAt(salida, 0)).toBe('09:30 AM');
  });

  it('corre los minutos del tramo y cruza al mediodía', () => {
    expect(clockAt(salida, 45)).toBe('10:15 AM');
    expect(clockAt(salida, 150)).toBe('12:00 PM');
    expect(clockAt(salida, 210)).toBe('01:00 PM');
  });

  it('medianoche es 12 AM, no 00', () => {
    expect(clockAt(new Date(2026, 6, 29, 0, 5), 0)).toBe('12:05 AM');
  });
});

describe('humanDuration / humanDistance', () => {
  it('formatea horas y minutos', () => {
    expect(humanDuration(225)).toBe('3h 45m');
    expect(humanDuration(45)).toBe('45m');
  });

  it('sin dato muestra un guión, no un cero', () => {
    expect(humanDuration(undefined)).toBe('—');
    expect(humanDistance(undefined)).toBe('—');
  });

  it('la distancia va con un decimal', () => {
    expect(humanDistance(12.4)).toBe('12.4 km');
    expect(humanDistance(9)).toBe('9.0 km');
  });
});

describe('straightLine', () => {
  it('respeta el orden y saltea las paradas sin punto', () => {
    const line = straightLine([
      { latitude: -17.78, longitude: -63.18 },
      { latitude: undefined, longitude: undefined },
      { latitude: -17.75, longitude: -63.2 },
    ]);
    expect(line).toEqual([
      { latitude: -17.78, longitude: -63.18 },
      { latitude: -17.75, longitude: -63.2 },
    ]);
  });
});
