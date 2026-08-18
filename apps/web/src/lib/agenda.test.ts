import { describe, expect, it } from 'vitest';
import { AgendaItemStatus, partitionDay } from '@kobrax/shared';
import {
  dayMetrics,
  dayOr,
  groupByAssignee,
  groupByHour,
  itemActions,
  loadByDay,
  monthGrid,
  shiftDay,
  shiftMonth,
  weekOf,
} from './agenda';

const NAMES = new Map([
  ['u1', 'Ana Quispe'],
  ['u2', 'Luis Flores'],
]);
const nameOf = (id: string) => NAMES.get(id);

describe('shiftDay', () => {
  it('cruza el fin de mes sin corrimientos', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('cruza el año y el bisiesto', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('todo en UTC: al oeste de Greenwich, en hora local se corría un día entero', () => {
    expect(shiftDay('2026-08-12', 0)).toBe('2026-08-12');
  });
});

describe('dayOr', () => {
  it('una fecha inventada en la URL cae en hoy, no rompe la pantalla', () => {
    expect(dayOr('2026-08-12', 'ayer')).toBe('2026-08-12');
    expect(dayOr('2026-08-12', '2026-8-1')).toBe('2026-08-12');
    expect(dayOr('2026-08-12', undefined)).toBe('2026-08-12');
    expect(dayOr('2026-08-12', '2026-07-04')).toBe('2026-07-04');
  });
});

describe('groupByAssignee', () => {
  const items = [
    { id: 'a', assigneeId: 'u2' },
    { id: 'b', assigneeId: 'u1' },
    { id: 'c' },
    { id: 'd', assigneeId: 'u2' },
  ];

  it('agrupa por cobrador y ordena por nombre', () => {
    const groups = groupByAssignee(items, nameOf, 'Sin cobrador');
    expect(groups.map((g) => g.name)).toEqual(['Ana Quispe', 'Luis Flores', 'Sin cobrador']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['a', 'd']);
  });

  it('los que no tienen a nadie van AL FINAL: son lo que falta repartir', () => {
    const groups = groupByAssignee(items, nameOf, 'Sin cobrador');
    expect(groups.at(-1)).toMatchObject({ assigneeId: null, name: 'Sin cobrador' });
  });

  it('un cobrador que ya no está en el equipo se muestra igual, con su id', () => {
    // Dado de baja después de agendar: esconder la gestión sería perder trabajo de la vista.
    const groups = groupByAssignee([{ id: 'x', assigneeId: 'borrado' }], nameOf, 'Sin cobrador');
    expect(groups[0]).toMatchObject({ assigneeId: 'borrado', name: 'borrado' });
  });

  it('sin gestiones no inventa grupos', () => {
    expect(groupByAssignee([], nameOf, 'Sin cobrador')).toEqual([]);
  });
});

describe('partitionDay + itemActions', () => {
  const items = [
    { id: '1', status: AgendaItemStatus.SCHEDULED },
    { id: '2', status: AgendaItemStatus.EXECUTED },
    { id: '3', status: AgendaItemStatus.CANCELLED },
    { id: '4', status: AgendaItemStatus.RESCHEDULED },
  ];

  it('🔴 hecho es todo lo que ya no está pendiente, no sólo lo ejecutado', () => {
    // La regla vive en shared y la comparte con el móvil, donde una gestión cancelada llegó a
    // desaparecer del día — cancelar quedaba indistinguible de eliminar.
    const { pending, done } = partitionDay(items);
    expect(pending.map((i) => i.id)).toEqual(['1']);
    expect(done.map((i) => i.id)).toEqual(['2', '3', '4']);
  });

  it('sólo una gestión pendiente ofrece acciones, y editar no es una de ellas', () => {
    // Editar la hora o la observación es trabajo del teléfono, que es donde se agendó.
    expect(itemActions(AgendaItemStatus.SCHEDULED)).toEqual(['complete', 'reschedule', 'cancel']);
    for (const status of [AgendaItemStatus.EXECUTED, AgendaItemStatus.CANCELLED, AgendaItemStatus.RESCHEDULED]) {
      expect(itemActions(status)).toEqual([]);
    }
  });
});

// La semana arranca el LUNES, como el calendario de la región — no el domingo del `getUTCDay()`.
describe('weekOf', () => {
  it('devuelve los 7 días, de lunes a domingo', () => {
    // 2026-08-17 es lunes.
    expect(weekOf('2026-08-19')).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23',
    ]);
  });

  it('un domingo pertenece a la semana que EMPEZÓ, no a la que arranca', () => {
    expect(weekOf('2026-08-23')[0]).toBe('2026-08-17');
  });

  it('cruza el fin de mes sin corrimientos', () => {
    expect(weekOf('2026-09-01')).toContain('2026-08-31');
  });
});

describe('monthGrid', () => {
  it('siempre da semanas enteras: múltiplo de 7 y arranca en lunes', () => {
    const grid = monthGrid('2026-08-17');
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe('2026-07-27');
    expect(grid).toContain('2026-08-01');
    expect(grid).toContain('2026-08-31');
  });

  it('febrero de un año bisiesto entra completo', () => {
    expect(monthGrid('2028-02-10')).toContain('2028-02-29');
  });
});

// `setUTCMonth` sobre un día 31 se desborda al mes siguiente: por eso se normaliza al día 1.
describe('shiftMonth', () => {
  it('un 31 de enero no salta a marzo', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('cruza el año en los dos sentidos', () => {
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01');
  });
});

describe('groupByHour', () => {
  /**
   * 🔴 La hora aparece UNA vez. Antes cada fila repetía la suya, y un día con seis gestiones a las 9
   * mostraba «09:00» seis veces: la columna dejaba de leerse como línea de tiempo.
   */
  it('apila bajo un solo rótulo las que comparten hora', () => {
    const groups = groupByHour([{ h: '09:00' }, { h: '09:00' }, { h: '11:00' }], (i) => i.h);
    expect(groups.map((g) => g.when)).toEqual(['09:00', '11:00']);
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('respeta el orden que trajo el servidor y no reordena', () => {
    expect(groupByHour([{ h: '11:00' }, { h: '09:00' }], (i) => i.h).map((g) => g.when)).toEqual(['11:00', '09:00']);
  });

  it('la misma hora en dos tramos separados no se fusiona', () => {
    // Fusionándolos, una gestión sin hora quedaría en medio de las de las 9.
    expect(groupByHour([{ h: '09:00' }, { h: 'Sin hora' }, { h: '09:00' }], (i) => i.h)).toHaveLength(3);
  });
});

describe('loadByDay + dayMetrics', () => {
  const dia = (scheduledDate: string, status: AgendaItemStatus, isOverdue = false) => ({ scheduledDate, status, isOverdue });

  it('cuenta por día separando lo hecho de lo vencido', () => {
    const load = loadByDay([
      dia('2026-08-17', AgendaItemStatus.SCHEDULED),
      dia('2026-08-17', AgendaItemStatus.EXECUTED),
      dia('2026-08-18', AgendaItemStatus.SCHEDULED, true),
    ]);
    expect(load.get('2026-08-17')).toEqual({ total: 2, overdue: 0, done: 1 });
    expect(load.get('2026-08-18')).toEqual({ total: 1, overdue: 1, done: 0 });
  });

  // Una ejecutada tarde ya no le debe nada a nadie: no cuenta como vencida.
  it('vencida es sólo la que sigue pendiente', () => {
    expect(
      dayMetrics([
        { status: AgendaItemStatus.EXECUTED, isOverdue: true },
        { status: AgendaItemStatus.SCHEDULED, isOverdue: true },
      ]),
    ).toEqual({ total: 2, done: 1, overdue: 1, donePct: 50 });
  });

  // Cancelada y reagendada también salieron del pendiente: mismo corte que `partitionDay`.
  it('completadas es todo lo que ya no está pendiente', () => {
    expect(
      dayMetrics([
        { status: AgendaItemStatus.CANCELLED, isOverdue: false },
        { status: AgendaItemStatus.RESCHEDULED, isOverdue: false },
      ]).done,
    ).toBe(2);
  });

  it('un día vacío da 0 y no NaN', () => {
    expect(dayMetrics([])).toEqual({ total: 0, done: 0, overdue: 0, donePct: 0 });
  });
});
