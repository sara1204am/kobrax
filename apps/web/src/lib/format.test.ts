import { describe, expect, it } from 'vitest';
import { date, dayDate } from './format';

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
