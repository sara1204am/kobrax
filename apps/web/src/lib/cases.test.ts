import { describe, expect, it } from 'vitest';
import { assignedTo } from './cases';

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

