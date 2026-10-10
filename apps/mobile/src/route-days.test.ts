import { addDays, isPlannableDay, planningDays } from './route-days';

describe('route-days (D-6)', () => {
  it('addDays cruza fin de mes y de año sin tocar la zona horaria', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('ofrece hoy y los 14 días siguientes, en orden', () => {
    const dias = planningDays('2026-10-09');
    expect(dias).toHaveLength(15);
    expect(dias[0]).toMatchObject({ date: '2026-10-09', label: 'Hoy', offset: 0 });
    expect(dias[1]).toMatchObject({ date: '2026-10-10', label: 'Mañana', offset: 1 });
    expect(dias.at(-1)).toMatchObject({ date: '2026-10-23', offset: 14 });
  });

  it('el rótulo del resto es el día de la semana', () => {
    // 2026-10-11 es domingo.
    expect(planningDays('2026-10-09')[2]).toMatchObject({ date: '2026-10-11', label: 'Dom', dayOfMonth: '11' });
  });

  it('isPlannableDay: dentro del rango sí; pasado, más allá del tope o con formato raro, no', () => {
    const hoy = '2026-10-09';
    expect(isPlannableDay('2026-10-09', hoy)).toBe(true);
    expect(isPlannableDay('2026-10-23', hoy)).toBe(true);
    expect(isPlannableDay('2026-10-24', hoy)).toBe(false);
    expect(isPlannableDay('2026-10-08', hoy)).toBe(false);
    expect(isPlannableDay('mañana', hoy)).toBe(false);
    expect(isPlannableDay(undefined, hoy)).toBe(false);
  });
});
