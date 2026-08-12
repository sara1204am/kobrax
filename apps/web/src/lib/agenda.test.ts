import { describe, expect, it } from 'vitest';
import { AgendaItemStatus, partitionDay } from '@kobrax/shared';
import { dayOr, groupByAssignee, itemActions, shiftDay } from './agenda';

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

  it('sólo una gestión pendiente ofrece acciones', () => {
    expect(itemActions(AgendaItemStatus.SCHEDULED)).toEqual(['complete', 'reschedule', 'cancel', 'edit']);
    for (const status of [AgendaItemStatus.EXECUTED, AgendaItemStatus.CANCELLED, AgendaItemStatus.RESCHEDULED]) {
      expect(itemActions(status)).toEqual([]);
    }
  });
});
