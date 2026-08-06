import { whenLabel } from './notifications.service';

describe('whenLabel', () => {
  it('de hoy muestra la hora, no la fecha', () => {
    const hoy = new Date(2026, 7, 6, 14, 32);
    expect(whenLabel(hoy.toISOString(), '2026-08-06')).toBe('14:32');
  });

  it('de otro día muestra la fecha', () => {
    const ayer = new Date(2026, 7, 5, 14, 32);
    expect(whenLabel(ayer.toISOString(), '2026-08-06')).toBe('Miércoles, 5 de agosto');
  });

  // Una notificación de las 23:50 locales cae en el día UTC siguiente: comparar contra un "hoy"
  // en UTC la mandaría a la rama de fecha estando el cobrador todavía en el mismo día.
  it('usa el día LOCAL, no el UTC', () => {
    const tarde = new Date(2026, 7, 6, 23, 50);
    expect(whenLabel(tarde.toISOString(), '2026-08-06')).toBe('23:50');
  });

  it('una fecha inválida no rompe la fila', () => {
    expect(whenLabel('no-es-fecha')).toBe('');
  });
});
