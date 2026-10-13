import { describe, expect, it } from 'vitest';
import {
  collectionFormError,
  collectionFormFromProfile,
  collectionProfileFromForm,
  emptyCollectionForm,
  hasCollectionData,
  sameCollection,
  validateCollectionProfile,
} from './collection-profile.js';
import { buildClientePayload, hydrateCliente, initialCliente, locationPayload, emptyLocation } from './client-form.js';
import { diffCliente } from './client-diff.js';

describe('validateCollectionProfile', () => {
  it('un perfil completo es válido', () => {
    expect(validateCollectionProfile({ modality: 'AT_BUSINESS', frequency: 'DAILY', window: { from: '08:00', to: '10:30' }, days: [1, 2, 3, 4, 5, 6], handoverBy: 'EMPLOYEE', note: 'Tocar el portón verde' })).toBeNull();
  });
  it('uno vacío también: todo es opcional', () => expect(validateCollectionProfile({})).toBeNull());

  it('no acepta lo que no es un objeto', () => {
    for (const v of [null, 'x', 5, []]) expect(validateCollectionProfile(v)).toBe('NOT_OBJECT');
  });

  it('🔴 rechaza campos desconocidos: la columna aceptaba cualquier cosa y nadie sabía qué significaba', () => {
    expect(validateCollectionProfile({ modality: 'PICK_UP', color: 'rojo' })).toBe('UNKNOWN_FIELD');
  });

  it('la modalidad es un código de catálogo', () => {
    expect(validateCollectionProfile({ modality: 'recoger la cuota' })).toBe('MODALITY_INVALID');
    expect(validateCollectionProfile({ modality: '' })).toBe('MODALITY_INVALID');
    expect(validateCollectionProfile({ modality: 'A'.repeat(41) })).toBe('MODALITY_INVALID');
    expect(validateCollectionProfile({ modality: 'PICK_UP' })).toBeNull();
  });

  it('la frecuencia es una conocida', () => {
    expect(validateCollectionProfile({ frequency: 'HOURLY' })).toBe('FREQUENCY_INVALID');
    for (const f of ['DAILY', 'WEEKLY', 'PER_INSTALLMENT']) expect(validateCollectionProfile({ frequency: f })).toBeNull();
  });

  it('🔴 la franja tiene dos horas «HH:mm» y termina después de empezar', () => {
    expect(validateCollectionProfile({ window: { from: '8:00', to: '10:00' } })).toBe('WINDOW_INVALID');
    expect(validateCollectionProfile({ window: { from: '08:00', to: '25:00' } })).toBe('WINDOW_INVALID');
    expect(validateCollectionProfile({ window: { from: '18:00', to: '08:00' } })).toBe('WINDOW_INVALID');
    expect(validateCollectionProfile({ window: { from: '08:00', to: '08:00' } })).toBe('WINDOW_INVALID');
    expect(validateCollectionProfile({ window: { from: '08:00' } })).toBe('WINDOW_INVALID');
    expect(validateCollectionProfile({ window: '08:00-10:00' })).toBe('WINDOW_INVALID');
  });

  it('los días son 1 a 7 (ISO), sin repetir', () => {
    expect(validateCollectionProfile({ days: [] })).toBe('DAYS_INVALID');
    expect(validateCollectionProfile({ days: [0] })).toBe('DAYS_INVALID');
    expect(validateCollectionProfile({ days: [8] })).toBe('DAYS_INVALID');
    expect(validateCollectionProfile({ days: [1, 1] })).toBe('DAYS_INVALID');
    expect(validateCollectionProfile({ days: [1.5] })).toBe('DAYS_INVALID');
    expect(validateCollectionProfile({ days: [6, 7] })).toBeNull();
  });

  it('quién entrega es uno de los conocidos y la nota tiene tope', () => {
    expect(validateCollectionProfile({ handoverBy: 'VECINO' })).toBe('HANDOVER_INVALID');
    expect(validateCollectionProfile({ note: 'x'.repeat(281) })).toBe('NOTE_INVALID');
    expect(validateCollectionProfile({ note: 5 })).toBe('NOTE_INVALID');
  });
});

describe('formulario ↔ perfil', () => {
  it('un formulario vacío no es un perfil', () => {
    const f = emptyCollectionForm();
    expect(hasCollectionData(f)).toBe(false);
    expect(collectionProfileFromForm(f)).toBeUndefined();
  });

  it('ida y vuelta conserva todo, con los días ordenados', () => {
    const profile = { modality: 'PICK_UP', frequency: 'DAILY' as const, window: { from: '07:00', to: '09:00' }, days: [3, 1, 2], handoverBy: 'FAMILY' as const, note: 'Con su hijo' };
    const form = collectionFormFromProfile(profile);
    expect(collectionProfileFromForm(form)).toEqual({ ...profile, days: [1, 2, 3] });
  });

  it('🔴 media franja no se manda: sin las dos horas no hay franja', () => {
    const f = { ...emptyCollectionForm(), modality: 'AT_BUSINESS', windowFrom: '08:00' };
    expect(collectionProfileFromForm(f)).toEqual({ modality: 'AT_BUSINESS' });
    expect(collectionFormError(f)).toBe('WINDOW_INVALID');
  });

  it('🔴 hidratar tolera lo que la columna tuviera antes del esquema: abrir un cliente antiguo no puede fallar', () => {
    expect(collectionFormFromProfile(null)).toEqual(emptyCollectionForm());
    expect(collectionFormFromProfile('basura')).toEqual(emptyCollectionForm());
    expect(collectionFormFromProfile({ lo_que_sea: 1, modality: 'AT_HOME', window: { from: 'x', to: 'y' }, days: [0, 2, 9] })).toEqual({
      ...emptyCollectionForm(),
      modality: 'AT_HOME',
      days: [2],
    });
  });

  it('sameCollection compara por el perfil resultante, no por el texto', () => {
    const a = { ...emptyCollectionForm(), note: ' hola ' };
    const b = { ...emptyCollectionForm(), note: 'hola' };
    expect(sameCollection(a, b)).toBe(true);
    expect(sameCollection(a, { ...b, modality: 'PICK_UP' })).toBe(false);
  });
});

describe('integración con el alta, el payload y el diff del cliente', () => {
  const server = {
    clientType: 'PERSON' as const,
    firstName: 'Ana',
    lastName: 'Quispe',
    nationalId: '123',
    status: 'ACTIVE' as const,
    preferredContactChannel: 'PHONE',
    contacts: [],
    locations: [{ id: 'loc-1', locationType: 'WORK', address: 'Mercado Rodríguez, puesto 12', visitSchedule: { modality: 'AT_BUSINESS', frequency: 'DAILY', window: { from: '08:00', to: '10:00' } } }],
  };

  it('el alta con perfil lo manda dentro de la ubicación', () => {
    const f = initialCliente();
    f.firstName = 'Ana';
    f.lastName = 'Quispe';
    const loc = emptyLocation('l0');
    loc.address = 'Calle 1';
    loc.collection = { ...emptyCollectionForm(), modality: 'PICK_UP' };
    f.locations = [loc];
    expect(buildClientePayload(f).locations?.[0]?.visitSchedule).toEqual({ modality: 'PICK_UP' });
  });

  it('una ubicación nueva sin perfil no manda `visitSchedule`', () => {
    expect(locationPayload(emptyLocation('x')).visitSchedule).toBeUndefined();
  });

  it('hidrata el perfil y el canal preferido del servidor', () => {
    const f = hydrateCliente(server);
    expect(f.preferredContactChannel).toBe('PHONE');
    expect(f.locations[0]!.collection.modality).toBe('AT_BUSINESS');
    expect(f.locations[0]!.collection.windowFrom).toBe('08:00');
  });

  it('🔴 abrir y guardar sin tocar nada no genera cambios', () => {
    const f = hydrateCliente(server);
    const ops = diffCliente(f, hydrateCliente(server));
    expect(ops.locations.update).toHaveLength(0);
    expect(ops.client).toBeUndefined();
  });

  it('cambiar la modalidad actualiza la ubicación', () => {
    const before = hydrateCliente(server);
    const after = hydrateCliente(server);
    after.locations[0]!.collection.modality = 'PICK_UP';
    expect(diffCliente(before, after).locations.update).toHaveLength(1);
  });

  it('🔴 quitar el perfil de una ubicación que ya lo tenía manda null para borrarlo', () => {
    const after = hydrateCliente(server);
    after.locations[0]!.collection = emptyCollectionForm();
    expect(locationPayload(after.locations[0]!).visitSchedule).toBeNull();
  });

  it('cambiar el canal preferido llega como cambio del cliente', () => {
    const before = hydrateCliente(server);
    const after = hydrateCliente(server);
    after.preferredContactChannel = 'WHATSAPP';
    expect(diffCliente(before, after).client).toEqual({ preferredContactChannel: 'WHATSAPP' });
  });
});

describe('filas anteriores al campo (borradores, cachés)', () => {
  it('🔴 una ubicación sin `collection` no rompe el payload ni el diff: falta = vacío', () => {
    const vieja = { ...emptyLocation('x'), collection: undefined } as unknown as ReturnType<typeof emptyLocation>;
    expect(locationPayload(vieja).visitSchedule).toBeUndefined();
    expect(hasCollectionData(undefined)).toBe(false);
    expect(collectionProfileFromForm(undefined)).toBeUndefined();
    expect(sameCollection(undefined, emptyCollectionForm())).toBe(true);
    expect(collectionFormError(undefined)).toBeNull();
  });
});
