import { describe, expect, it } from 'vitest';
import { initialCliente, type ClientDuplicateCheck, type ClienteForm } from '@kobrax/shared';
import { duplicateBlocks, duplicateCheckInput, nameSignature } from './duplicate-check';

const form = (patch: Partial<ClienteForm>): ClienteForm => ({ ...initialCliente(), ...patch });
const match = { id: 'c1', displayName: 'Juan Pérez', maskedDocument: '12345***', status: 'ACTIVE', creditCount: 1, deleted: false, otherDocument: false } as const;

describe('duplicateCheckInput', () => {
  it('sin carnet ni nombre completo no pregunta nada', () => {
    expect(duplicateCheckInput(form({ firstName: 'Juan' }))).toBeNull();
    expect(duplicateCheckInput(form({ nationalId: '12' }))).toBeNull();
  });

  it('con el carnet alcanza; el nombre se manda recién con nombre y apellido', () => {
    expect(duplicateCheckInput(form({ nationalId: ' 1234567 ', firstName: 'Juan' }))).toEqual({ clientType: 'PERSON', nationalId: '1234567' });
    expect(duplicateCheckInput(form({ firstName: ' Juan ', lastName: 'Pérez' }))).toEqual({ clientType: 'PERSON', firstName: 'Juan', lastName: 'Pérez' });
  });

  it('empresa: pregunta por la razón social', () => {
    expect(duplicateCheckInput(form({ clientType: 'COMPANY', businessName: 'Andina SRL', firstName: 'x' }))).toEqual({ clientType: 'COMPANY', businessName: 'Andina SRL' });
  });
});

describe('nameSignature', () => {
  // La confirmación «es otra persona» vale para ese nombre: espacios o mayúsculas no la anulan, otro nombre sí.
  it('ignora espacios y mayúsculas, no otro nombre', () => {
    expect(nameSignature(form({ firstName: 'Juan ', lastName: 'PÉREZ' }))).toBe(nameSignature(form({ firstName: 'juan', lastName: 'pérez' })));
    expect(nameSignature(form({ firstName: 'Juan', lastName: 'Pérez' }))).not.toBe(nameSignature(form({ firstName: 'Juana', lastName: 'Pérez' })));
  });
});

describe('duplicateBlocks', () => {
  const check = (p: Partial<ClientDuplicateCheck>): ClientDuplicateCheck => ({ document: null, names: [], ...p });

  it('el carnet bloquea siempre, aunque se haya confirmado el nombre', () => {
    expect(duplicateBlocks(check({ document: match }), true)).toBe('document');
  });

  it('los homónimos bloquean hasta que se confirma', () => {
    expect(duplicateBlocks(check({ names: [match] }), false)).toBe('names');
    expect(duplicateBlocks(check({ names: [match] }), true)).toBeNull();
  });

  it('sin respuesta (falló el chequeo) no bloquea: el servidor frena el carnet igual', () => {
    expect(duplicateBlocks(null, false)).toBeNull();
  });
});
