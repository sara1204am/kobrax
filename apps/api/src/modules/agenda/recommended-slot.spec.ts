import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgendaTimeSlot } from '@kobrax/shared';
import { recommendedSlot, type SlotSource } from './recommended-slot';

const lapse = (timeSlot: AgendaTimeSlot): SlotSource => ({ timeSlot, scheduledTime: null });
const fixed = (scheduledTime: string): SlotSource => ({ timeSlot: null, scheduledTime });

describe('recommendedSlot', () => {
  it('gana la franja con más contactos efectivos', () => {
    const hint = recommendedSlot([
      lapse(AgendaTimeSlot.MORNING),
      lapse(AgendaTimeSlot.AFTERNOON),
      lapse(AgendaTimeSlot.AFTERNOON),
      lapse(AgendaTimeSlot.AFTERNOON),
    ]);
    assert.deepEqual(hint, { timeSlot: AgendaTimeSlot.AFTERNOON, basedOn: 3 });
  });

  it('una gestión de hora fija cuenta en la franja donde cae', () => {
    // 09:00 y 10:30 son mañana; 20:00 es noche. Gana la mañana con 2.
    const hint = recommendedSlot([fixed('09:00'), fixed('10:30'), fixed('20:00')]);
    assert.deepEqual(hint, { timeSlot: AgendaTimeSlot.MORNING, basedOn: 2 });
  });

  it('mezcla franja y hora fija en la misma cuenta', () => {
    const hint = recommendedSlot([lapse(AgendaTimeSlot.NIGHT), fixed('19:00'), lapse(AgendaTimeSlot.MORNING)]);
    assert.deepEqual(hint, { timeSlot: AgendaTimeSlot.NIGHT, basedOn: 2 });
  });

  it('con un solo contacto NO recomienda nada (no es estadística, es una corazonada)', () => {
    assert.equal(recommendedSlot([lapse(AgendaTimeSlot.MORNING)]), undefined);
  });

  it('sin historial no recomienda nada', () => {
    assert.equal(recommendedSlot([]), undefined);
  });

  it('una gestión sin franja ni hora no aporta y no rompe la cuenta', () => {
    const hint = recommendedSlot([
      { timeSlot: null, scheduledTime: null },
      lapse(AgendaTimeSlot.MORNING),
      lapse(AgendaTimeSlot.MORNING),
    ]);
    assert.deepEqual(hint, { timeSlot: AgendaTimeSlot.MORNING, basedOn: 2 });
  });

  it('un timeSlot desconocido en la DB se ignora', () => {
    const hint = recommendedSlot([
      { timeSlot: 'DAWN', scheduledTime: null },
      lapse(AgendaTimeSlot.AFTERNOON),
      lapse(AgendaTimeSlot.AFTERNOON),
    ]);
    assert.deepEqual(hint, { timeSlot: AgendaTimeSlot.AFTERNOON, basedOn: 2 });
  });

  it('el empate lo gana la franja más temprana, siempre igual', () => {
    const empate = [lapse(AgendaTimeSlot.NIGHT), lapse(AgendaTimeSlot.NIGHT), lapse(AgendaTimeSlot.MORNING), lapse(AgendaTimeSlot.MORNING)];
    assert.deepEqual(recommendedSlot(empate), { timeSlot: AgendaTimeSlot.MORNING, basedOn: 2 });
    // Mismo resultado con la entrada al revés: el orden de llegada no decide.
    assert.deepEqual(recommendedSlot([...empate].reverse()), { timeSlot: AgendaTimeSlot.MORNING, basedOn: 2 });
  });
});
