import { describe, expect, it } from 'vitest';
import { CaseStatus } from '@kobrax/shared';
import { assignedTo, canClose, nextStates } from './cases';
describe('nextStates', () => {
  it('ofrece sólo lo que la máquina de estados permite', () => {
    expect(nextStates(CaseStatus.PENDING)).toEqual([CaseStatus.ACTIVE]);
    expect(nextStates(CaseStatus.PROMISE_TO_PAY)).toEqual([CaseStatus.PAID, CaseStatus.ACTIVE]);
  });

  it('🔴 CLOSED nunca sale por el control de estados', () => {
    // Tiene su propio endpoint, exige motivo y pide otro permiso: mezclarlo lo haría parecer un
    // cambio de estado más, y es el único que no se puede deshacer.
    for (const from of Object.values(CaseStatus)) {
      expect(nextStates(from)).not.toContain(CaseStatus.CLOSED);
    }
    expect(nextStates(CaseStatus.PAID)).toEqual([]);
  });

  it('un caso terminal no ofrece nada', () => {
    expect(nextStates(CaseStatus.CLOSED)).toEqual([]);
    expect(nextStates(CaseStatus.WRITTEN_OFF)).toEqual([]);
  });
});

describe('canClose', () => {
  it('sólo se cierra lo que ya está pagado', () => {
    expect(canClose(CaseStatus.PAID)).toBe(true);
    expect(canClose(CaseStatus.ACTIVE)).toBe(false);
    expect(canClose(CaseStatus.CLOSED)).toBe(false);
  });
});

describe('assignedTo', () => {
  const ID = 'bf2e039c-ea1b-4628-883e-8ed117f47bc6';

  it('lee el id de la nota que escribe la API hoy', () => {
    expect(assignedTo(ID)).toBe(ID);
  });

  it('🔴 y también el de las filas viejas, que traen la frase adelante', () => {
    // La API guardaba `Asignado a <uuid>`: sin esto, la bitácora seguiría mostrando el uuid crudo
    // en todo lo ya registrado, que es justo donde se vio el problema.
    expect(assignedTo(`Asignado a ${ID}`)).toBe(ID);
  });

  it('una nota escrita por una persona no se confunde con una asignación', () => {
    expect(assignedTo('no atendió, se pasa al martes')).toBe(null);
    expect(assignedTo(null)).toBe(null);
    expect(assignedTo(undefined)).toBe(null);
  });
});

