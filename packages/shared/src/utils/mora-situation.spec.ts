import { describe, expect, it } from 'vitest';
import { moraSituation } from './mora-situation.js';

describe('moraSituation', () => {
  it('sin episodio abierto está al día', () => {
    expect(moraSituation({ hasOpenEpisode: false, daysPastDue: 0 })).toEqual({ situation: 'CURRENT', writtenOff: false });
  });

  it('con episodio abierto está en mora', () => {
    expect(moraSituation({ hasOpenEpisode: true, daysPastDue: 47 })).toEqual({ situation: 'IN_ARREARS', writtenOff: false });
  });

  it('🔴 la situación sale SÓLO del episodio, no de los días', () => {
    expect(moraSituation({ hasOpenEpisode: false, daysPastDue: 90 }).situation).toBe('CURRENT');
    expect(moraSituation({ hasOpenEpisode: true, daysPastDue: 0 }).situation).toBe('IN_ARREARS');
  });

  it('🔴 castigado con 240 días de mora sigue En mora', () => {
    expect(moraSituation({ hasOpenEpisode: true, daysPastDue: 240, writtenOffAt: '2026-09-01T00:00:00.000Z' })).toEqual({
      situation: 'IN_ARREARS',
      writtenOff: true,
    });
  });

  it('el castigo es independiente: puede estar castigado y sin mora abierta', () => {
    expect(moraSituation({ hasOpenEpisode: false, writtenOffAt: new Date() })).toEqual({ situation: 'CURRENT', writtenOff: true });
  });

  it('writtenOffAt nulo o ausente no es castigo', () => {
    expect(moraSituation({ hasOpenEpisode: true, writtenOffAt: null }).writtenOff).toBe(false);
    expect(moraSituation({ hasOpenEpisode: true }).writtenOff).toBe(false);
  });
});
