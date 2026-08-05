import { describe, expect, it } from 'vitest';
import { VisitOutcome } from '../enums/visit-outcome.enum.js';
import { validateVisitDetails } from './visit-details.js';

/** Extrae los errores; falla si el caso era válido (así el test dice qué pasó, no `undefined`). */
function errorsOf(outcome: `${VisitOutcome}`, details: unknown): string[] {
  const res = validateVisitDetails(outcome, details);
  if (res.ok) throw new Error(`se esperaba inválido, pero pasó: ${JSON.stringify(res.value)}`);
  return res.errors;
}

describe('validateVisitDetails · NO_CONTACT', () => {
  it('exige por dónde se intentó el contacto', () => {
    expect(errorsOf(VisitOutcome.NO_CONTACT, {})[0]).toMatch(/channel/);
  });

  it('rechaza un canal inventado', () => {
    expect(errorsOf(VisitOutcome.NO_CONTACT, { channel: 'PALOMA' })).toHaveLength(1);
  });

  it('acepta llamada y puerta', () => {
    expect(validateVisitDetails(VisitOutcome.NO_CONTACT, { channel: 'CALL' })).toEqual({
      ok: true,
      value: { channel: 'CALL' },
    });
    expect(validateVisitDetails(VisitOutcome.NO_CONTACT, { channel: 'DOOR' })).toEqual({
      ok: true,
      value: { channel: 'DOOR' },
    });
  });

  it('guarda el aviso dejado sólo cuando es verdadero', () => {
    expect(validateVisitDetails(VisitOutcome.NO_CONTACT, { channel: 'DOOR', noticeLeft: true })).toEqual({
      ok: true,
      value: { channel: 'DOOR', noticeLeft: true },
    });
    // `false` y ausente significan lo mismo: no se guarda ninguno de los dos.
    expect(validateVisitDetails(VisitOutcome.NO_CONTACT, { channel: 'DOOR', noticeLeft: false })).toEqual({
      ok: true,
      value: { channel: 'DOOR' },
    });
  });

  it('descarta las claves ajenas — no se guarda lo que el cliente mande de más', () => {
    expect(validateVisitDetails(VisitOutcome.NO_CONTACT, { channel: 'CALL', gpsFallback: true, loQueSea: 1 })).toEqual({
      ok: true,
      value: { channel: 'CALL' },
    });
  });
});

describe('validateVisitDetails · SPECIAL', () => {
  it('exige la categoría', () => {
    expect(errorsOf(VisitOutcome.SPECIAL, {})).toHaveLength(1);
    expect(errorsOf(VisitOutcome.SPECIAL, { categoryCode: '   ' })).toHaveLength(1);
  });

  it('normaliza los espacios', () => {
    expect(validateVisitDetails(VisitOutcome.SPECIAL, { categoryCode: ' DECEASED ' })).toEqual({
      ok: true,
      value: { categoryCode: 'DECEASED' },
    });
  });

  it('corta una categoría absurdamente larga', () => {
    expect(errorsOf(VisitOutcome.SPECIAL, { categoryCode: 'X'.repeat(51) })).toHaveLength(1);
  });
});

describe('validateVisitDetails · el resto de las variantes', () => {
  it('cobrado, promesa y dirección incorrecta no tienen campos propios', () => {
    for (const o of [VisitOutcome.PAID, VisitOutcome.PARTIAL_PAYMENT, VisitOutcome.PROMISE_TO_PAY, VisitOutcome.WRONG_ADDRESS]) {
      expect(validateVisitDetails(o, { channel: 'CALL' })).toEqual({ ok: true, value: {} });
    }
  });

  it('un `details` que no es objeto no rompe', () => {
    expect(validateVisitDetails(VisitOutcome.PAID, null)).toEqual({ ok: true, value: {} });
    expect(errorsOf(VisitOutcome.NO_CONTACT, 'texto')).toHaveLength(1);
  });
});
