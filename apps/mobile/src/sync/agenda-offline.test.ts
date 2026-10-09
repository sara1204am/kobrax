import type { AgendaListItem } from '@kobrax/shared';
import { addDays, agendaDetailIds } from './agenda-offline';

const item = (id: string, scheduledDate: string, over: Partial<AgendaListItem> = {}) =>
  ({ id, scheduledDate: `${scheduledDate}T00:00:00.000Z`, status: 'SCHEDULED', scheduledTime: '09:00', ...over }) as unknown as AgendaListItem;

describe('agendaDetailIds', () => {
  const TODAY = '2026-10-07';

  it('solo las pendientes: una ejecutada o cancelada no se baja', () => {
    const ids = agendaDetailIds([item('a', TODAY), item('b', TODAY, { status: 'EXECUTED' as never }), item('c', TODAY, { status: 'CANCELLED' as never })], TODAY);
    expect(ids).toEqual(['a']);
  });

  it('hoy primero, luego lo vencido y luego lo que viene, por fecha y hora', () => {
    const ids = agendaDetailIds(
      [item('futura', '2026-10-09'), item('vencida', '2026-10-01'), item('hoy-tarde', TODAY, { scheduledTime: '15:00' }), item('hoy-temprano', TODAY, { scheduledTime: '08:00' }), item('manana', '2026-10-08')],
      TODAY,
    );
    expect(ids).toEqual(['hoy-temprano', 'hoy-tarde', 'vencida', 'manana', 'futura']);
  });

  it('las de franja (sin hora) van después de las de hora fija del mismo día', () => {
    const ids = agendaDetailIds([item('franja', TODAY, { scheduledTime: undefined }), item('fija', TODAY, { scheduledTime: '10:00' })], TODAY);
    expect(ids).toEqual(['fija', 'franja']);
  });

  it('no repite una gestión que aparece en dos listas (por ejemplo, hoy y vencidas)', () => {
    expect(agendaDetailIds([item('a', TODAY), item('a', TODAY)], TODAY)).toEqual(['a']);
  });

  it('con más que el techo se quedan afuera las más lejanas, no las de hoy', () => {
    const items = [item('lejana', '2026-10-14'), item('hoy', TODAY), item('manana', '2026-10-08')];
    expect(agendaDetailIds(items, TODAY, 2)).toEqual(['hoy', 'manana']);
  });
});

describe('addDays', () => {
  it('suma días de calendario, también cruzando el mes', () => {
    expect(addDays('2026-10-07', 7)).toBe('2026-10-14');
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });
});
