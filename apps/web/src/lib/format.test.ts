import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISPLAY_TIME_ZONE, date, dateTime, dayDate, relativeDate, time } from './format';

/**
 * 🔴 Sólo el día civil. Este archivo existe por **un** defecto: una ruta del 20 de agosto se
 * mostraba como del 19.
 */
describe('dayDate', () => {
  // Lo que manda la API para un `@db.Date`: el día a medianoche UTC.
  const DIA = '2026-08-20T00:00:00.000Z';

  it('mantiene el día, no el que resulta de restarle la diferencia horaria', () => {
    expect(dayDate(DIA, 'es')).toContain('20');
    expect(dayDate(DIA, 'en')).toContain('20');
  });

  it('🔴 y por eso NO es lo mismo que `date()` al oeste de Greenwich', () => {
    // En Bolivia (UTC−4) `date()` devuelve el 19: la ruta del jueves aparecía como la del miércoles.
    // `date()` sigue siendo el correcto para lo que sí tiene hora. Ahora va fijo en la zona de la
    // cuenta, así que el resultado ya no depende de la máquina que corre la prueba.
    expect(date(DIA, 'es')).toContain('19');
    expect(date(DIA, 'es')).not.toBe(dayDate(DIA, 'es'));
  });

  it('sin fecha, una raya', () => {
    expect(dayDate(null)).toBe('—');
    expect(dayDate(undefined)).toBe('—');
  });
});

describe('time', () => {
  it('da la hora y el minuto, con dos dígitos', () => {
    // Es un instante, no un día civil: va en la hora de la cuenta (La Paz, UTC−4), no en la de la
    // máquina que renderiza. 13:05 UTC son las 09:05 en La Paz.
    expect(time('2026-08-20T13:05:00.000Z', 'es')).toMatch(/^09:05/);
  });

  it('una parada sin visitar no tiene hora, y se dice con una raya', () => {
    expect(time(null)).toBe('—');
    expect(time(undefined)).toBe('—');
  });
});

/**
 * 🔴 Estas funciones dan LO MISMO en el servidor y en el navegador. El 2026-10-13 el servidor de
 * producción (Europa, +2) pintaba «13/10/26, 15:30» y el navegador de Bolivia «13/10/26, 9:30»:
 * React avisaba con los errores #425 y #422 y la pantalla mostraba la hora seis horas corrida.
 */
describe('zona horaria fija (servidor = navegador)', () => {
  afterEach(() => vi.useRealTimers());

  it('la zona por defecto es la de las cuentas', () => {
    expect(DISPLAY_TIME_ZONE).toBe('America/La_Paz');
  });

  it('dateTime da la hora de La Paz, no la de la máquina', () => {
    // 13:30 UTC = 09:30 en La Paz. En un servidor con +2 daría 15:30.
    const out = dateTime('2026-10-13T13:30:00.000Z', 'es');
    expect(out).toContain('9:30');
    expect(out).not.toContain('15:30');
    expect(out).not.toContain('13:30');
  });

  it('una zona explícita manda sobre la de por defecto', () => {
    expect(time('2026-10-13T13:30:00.000Z', 'es', 'UTC')).toMatch(/^13:30/);
    expect(time('2026-10-13T13:30:00.000Z', 'es', 'America/Bogota')).toMatch(/^08:30/);
  });

  it('relativeDate cuenta los días del calendario de la cuenta', () => {
    // «Ahora» = 20 ago, 09:00 en La Paz. Las 22:00 del 19 en La Paz son las 02:00 UTC del 20:
    // contadas en UTC serían «hoy»; en La Paz, «ayer».
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T13:00:00.000Z'));
    expect(relativeDate('2026-08-20T02:00:00.000Z', 'es')).toMatch(/ayer/i);
    expect(relativeDate('2026-08-20T12:00:00.000Z', 'es')).toMatch(/hoy/i);
  });
});
