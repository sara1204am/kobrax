import { describe, expect, it } from 'vitest';
import { AGENDA_OUTCOMES_BY_TYPE, AgendaItemType, AgendaOutcome } from './agenda.enum.js';

describe('AGENDA_OUTCOMES_BY_TYPE', () => {
  it('cubre los 5 tipos de gestión', () => {
    for (const type of Object.values(AgendaItemType)) {
      expect(AGENDA_OUTCOMES_BY_TYPE[type]?.length, `${type} sin outcomes`).toBeGreaterThan(0);
    }
  });

  it('la promesa solo admite pagó / no pagó', () => {
    expect(AGENDA_OUTCOMES_BY_TYPE[AgendaItemType.PROMISE_TO_PAY]).toEqual([
      AgendaOutcome.PROMISE_KEPT,
      AgendaOutcome.PROMISE_BROKEN,
    ]);
  });

  it('la visita no ofrece "número equivocado" (no tiene número)', () => {
    expect(AGENDA_OUTCOMES_BY_TYPE[AgendaItemType.VISIT]).not.toContain(AgendaOutcome.WRONG_NUMBER);
    expect(AGENDA_OUTCOMES_BY_TYPE[AgendaItemType.VISIT]).toContain(AgendaOutcome.WRONG_ADDRESS);
  });
});
