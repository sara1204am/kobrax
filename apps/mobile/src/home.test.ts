import { AgendaItemStatus, AgendaItemType, ScheduleTimeMode } from '@kobrax/shared';
import { dayProgress, dueSoon, upNext } from './home';
import type { AgendaListItem } from './agenda.service';

function item(over: Partial<AgendaListItem>): AgendaListItem {
  return {
    id: Math.random().toString(36).slice(2),
    caseId: 'c',
    clientId: 'cl',
    creditId: 'cr',
    assigneeId: 'u',
    type: AgendaItemType.CALL,
    status: AgendaItemStatus.SCHEDULED,
    scheduledDate: '2026-08-06',
    timeMode: ScheduleTimeMode.SLOT,
    details: {},
    isOverdue: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const alas = (hhmm: string) => item({ timeMode: ScheduleTimeMode.FIXED, scheduledTime: hhmm });

describe('dayProgress', () => {
  it('cuenta lo resuelto sobre el total del día', () => {
    const p = dayProgress([
      item({ status: AgendaItemStatus.EXECUTED }),
      item({ status: AgendaItemStatus.EXECUTED }),
      item({ status: AgendaItemStatus.SCHEDULED }),
      item({ status: AgendaItemStatus.SCHEDULED }),
    ]);
    expect(p).toEqual({ done: 2, pending: 2, total: 4, percent: 50 });
  });

  // Si contaran como pendientes, el progreso jamás llegaría a 100% en un día con una cancelación.
  it('canceladas y reagendadas cuentan como resueltas, no como pendientes', () => {
    const p = dayProgress([
      item({ status: AgendaItemStatus.CANCELLED }),
      item({ status: AgendaItemStatus.RESCHEDULED }),
    ]);
    expect(p.percent).toBe(100);
    expect(p.pending).toBe(0);
  });

  it('un día vacío es 0%, no NaN', () => {
    expect(dayProgress([]).percent).toBe(0);
  });
});

describe('dueSoon', () => {
  const now = new Date(2026, 7, 6, 10, 0);

  it('agarra las de hora fija dentro de la ventana', () => {
    const r = dueSoon([alas('10:15'), alas('10:29'), alas('11:30')], now);
    expect(r.length).toBe(2);
  });

  it('no agarra las que ya pasaron', () => {
    expect(dueSoon([alas('09:45')], now).length).toBe(0);
  });

  // Una gestión "por la mañana" no tiene minuto: incluirla haría sonar la alarma todo el día.
  it('ignora las de franja horaria', () => {
    expect(dueSoon([item({ timeMode: ScheduleTimeMode.SLOT })], now).length).toBe(0);
  });

  it('ignora las que ya no están pendientes', () => {
    const hecha = item({ timeMode: ScheduleTimeMode.FIXED, scheduledTime: '10:15', status: AgendaItemStatus.EXECUTED });
    expect(dueSoon([hecha], now).length).toBe(0);
  });

  it('una hora con basura no rompe la banda', () => {
    expect(dueSoon([item({ timeMode: ScheduleTimeMode.FIXED, scheduledTime: '99:99' })], now).length).toBe(0);
  });
});

describe('upNext', () => {
  it('ordena por hora y deja las de franja al final', () => {
    const r = upNext([item({ timeMode: ScheduleTimeMode.SLOT }), alas('14:00'), alas('08:30')]);
    expect(r[0]!.scheduledTime).toBe('08:30');
    expect(r[1]!.scheduledTime).toBe('14:00');
    expect(r[2]!.timeMode).toBe(ScheduleTimeMode.SLOT);
  });

  it('sólo pendientes, y recorta al límite', () => {
    const items = [alas('08:00'), alas('09:00'), alas('10:00'), item({ status: AgendaItemStatus.EXECUTED })];
    expect(upNext(items, 2).length).toBe(2);
    expect(upNext(items).every((i) => i.status === AgendaItemStatus.SCHEDULED)).toBe(true);
  });
});
