import { describe, expect, it } from 'vitest';
import { date, dayDate, time } from './format';

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
    // Con el proceso en Bolivia (UTC−4), `date()` devuelve el 19: la ruta del jueves aparecía como
    // la del miércoles. `date()` sigue siendo el correcto para lo que sí tiene hora.
    const local = new Date(DIA).getUTCDate() !== new Date(DIA).getDate();
    if (local) expect(date(DIA, 'es')).not.toBe(dayDate(DIA, 'es'));
  });

  it('sin fecha, una raya', () => {
    expect(dayDate(null)).toBe('—');
    expect(dayDate(undefined)).toBe('—');
  });
});

describe('time', () => {
  it('da la hora y el minuto, con dos dígitos', () => {
    // Es un instante, no un día civil: va en hora local a propósito. Se compara contra lo que el
    // propio entorno considera esa hora, que es lo que va a ver quien mira la pantalla.
    const t = new Date('2026-08-20T13:05:00.000Z');
    expect(time(t.toISOString(), 'es')).toBe(
      t.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    );
    expect(time(t.toISOString(), 'es')).toMatch(/\d{2}:\d{2}/);
  });

  it('una parada sin visitar no tiene hora, y se dice con una raya', () => {
    expect(time(null)).toBe('—');
    expect(time(undefined)).toBe('—');
  });
});
