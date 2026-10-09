import type { AgendaListItem } from '@kobrax/shared';
import { MAX_REMINDERS, planReminders, reminderId } from './agenda-reminders';

const item = (id: string, scheduledDate: string, over: Record<string, unknown> = {}) =>
  ({ id, scheduledDate: `${scheduledDate}T00:00:00.000Z`, status: 'SCHEDULED', type: 'CALL', clientName: 'Pedro Ticona', ...over }) as unknown as AgendaListItem;

/** Las 07:00 del 7 de octubre, hora del teléfono. */
const NOW = new Date(2026, 9, 7, 7, 0, 0);

describe('planReminders', () => {
  it('una gestión con hora fija avisa 15 minutos antes', () => {
    const [r] = planReminders([item('g1', '2026-10-07', { scheduledTime: '09:30' })], NOW);
    expect(r!.at).toEqual(new Date(2026, 9, 7, 9, 15, 0));
    expect(r!.id).toBe(reminderId('g1'));
    expect(r!.title).toBe('Llamada con Pedro Ticona');
    expect(r!.body).toBe('En 15 min · 09:30');
  });

  it('una gestión por franja avisa cuando empieza la franja — antes no avisaba nunca', () => {
    const rs = planReminders(
      [item('m', '2026-10-07', { timeSlot: 'MORNING', type: 'VISIT' }), item('t', '2026-10-07', { timeSlot: 'AFTERNOON' }), item('n', '2026-10-07', { timeSlot: 'NIGHT' })],
      new Date(2026, 9, 7, 6, 0, 0),
    );
    expect(rs.map((r) => [r.itemId, r.at.getHours()])).toEqual([['m', 8], ['t', 13], ['n', 18]]);
    expect(rs[0]!.title).toBe('Visita con Pedro Ticona');
    expect(rs[0]!.body).toBe('Tienes esta gestión por la mañana');
  });

  it('no avisa de lo que ya pasó, ni de lo ya hecho, cancelado o reagendado', () => {
    const rs = planReminders(
      [
        item('pasada', '2026-10-07', { scheduledTime: '06:00' }),
        item('hecha', '2026-10-07', { scheduledTime: '10:00', status: 'EXECUTED' }),
        item('cancelada', '2026-10-07', { scheduledTime: '10:00', status: 'CANCELLED' }),
        item('reagendada', '2026-10-07', { scheduledTime: '10:00', status: 'RESCHEDULED' }),
        item('vence-en-10-min', '2026-10-07', { scheduledTime: '07:10' }),
        item('ok', '2026-10-07', { scheduledTime: '11:00' }),
      ],
      NOW,
    );
    // «07:10» avisaría a las 06:55, que ya pasó: no hay aviso útil.
    expect(rs.map((r) => r.itemId)).toEqual(['ok']);
  });

  it('una gestión sin hora ni franja no tiene a qué hora avisar', () => {
    expect(planReminders([item('x', '2026-10-07')], NOW)).toEqual([]);
  });

  it('del más cercano al más lejano, y sin repetir una gestión que viene en dos listas', () => {
    const rs = planReminders(
      [item('lejana', '2026-10-09', { scheduledTime: '09:00' }), item('hoy', '2026-10-07', { scheduledTime: '12:00' }), item('hoy', '2026-10-07', { scheduledTime: '12:00' })],
      NOW,
    );
    expect(rs.map((r) => r.itemId)).toEqual(['hoy', 'lejana']);
  });

  it('con más gestiones que el tope se quedan afuera las más lejanas', () => {
    const muchas = Array.from({ length: MAX_REMINDERS + 10 }, (_, i) =>
      item(`g${String(i).padStart(3, '0')}`, '2026-10-08', { scheduledTime: `${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}` }),
    );
    const rs = planReminders(muchas, NOW);
    expect(rs).toHaveLength(MAX_REMINDERS);
    expect(rs[0]!.itemId).toBe('g000');
  });

  it('la hora es de pared del teléfono: «las 15:30» de ese día, no un corrimiento de UTC', () => {
    const [r] = planReminders([item('g', '2026-10-07', { scheduledTime: '15:30' })], NOW);
    expect([r!.at.getFullYear(), r!.at.getMonth(), r!.at.getDate(), r!.at.getHours(), r!.at.getMinutes()]).toEqual([2026, 9, 7, 15, 15]);
  });
});
