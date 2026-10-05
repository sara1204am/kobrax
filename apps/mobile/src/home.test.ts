import { AgendaItemStatus, AgendaItemType, ScheduleTimeMode } from '@kobrax/shared';
import { dayProgress, dueSoon, queuedCollectedToday, upNext } from './home';
import type { AgendaListItem } from './agenda.service';

function item(over: Partial<AgendaListItem>): AgendaListItem {
  return {
    id: Math.random().toString(36).slice(2),
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

/**
 * «Cobrado hoy» del Home. Lo cobrado SIN SEÑAL todavía está en la cola, no en `GET /payments`: sin sumarlo el
 * Home decía «Bs 0» justo después de cobrar.
 */
describe('queuedCollectedToday', () => {
  const ahora = new Date(2026, 9, 3, 15, 0, 0); // 3 oct 2026, hora local
  const hoyAl = (h: number) => new Date(2026, 9, 3, h, 0, 0);

  it('suma los pagos encolados de hoy', () => {
    const total = queuedCollectedToday(
      [
        { action: { kind: 'payment', input: { amount: 100 } }, createdAt: hoyAl(9).getTime() },
        { action: { kind: 'payment', input: { amount: 50.5 } }, createdAt: hoyAl(11).getTime() },
      ],
      ahora,
    );
    expect(total).toBe(150.5);
  });

  it('incluye el cobro que viaja dentro de una visita encolada', () => {
    expect(
      queuedCollectedToday([{ action: { kind: 'visit', payment: { amount: 80 } }, createdAt: hoyAl(10).getTime() }], ahora),
    ).toBe(80);
  });

  it('un cobro de AYER que sigue en la cola no cuenta como de hoy', () => {
    const ayer = new Date(2026, 9, 2, 18, 0, 0).getTime();
    expect(queuedCollectedToday([{ action: { kind: 'payment', input: { amount: 100 } }, createdAt: ayer }], ahora)).toBe(0);
  });

  it('manda la hora del cobro (paymentDate), no la de cuando se encoló', () => {
    const cobradoAyer = new Date(2026, 9, 2, 20, 0, 0).toISOString();
    const encoladoHoy = hoyAl(8).getTime();
    expect(
      queuedCollectedToday([{ action: { kind: 'payment', input: { amount: 100, paymentDate: cobradoAyer } }, createdAt: encoladoHoy }], ahora),
    ).toBe(0);
  });

  it('ignora lo que no es un cobro y los pagos sin monto', () => {
    expect(
      queuedCollectedToday(
        [
          { action: { kind: 'agenda.create', input: { amount: 999 } }, createdAt: hoyAl(9).getTime() },
          { action: { kind: 'visit' }, createdAt: hoyAl(9).getTime() },
          { action: { kind: 'payment', input: {} }, createdAt: hoyAl(9).getTime() },
        ],
        ahora,
      ),
    ).toBe(0);
  });

  it('cola vacía = 0', () => {
    expect(queuedCollectedToday([], ahora)).toBe(0);
  });
});
