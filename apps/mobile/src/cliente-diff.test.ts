import { diffCliente, hasChanges } from './cliente-diff';
import { hydrateCliente } from './cliente-form';

const DETALLE = {
  clientType: 'PERSON' as const,
  firstName: 'Ana',
  lastName: 'Ruiz',
  nationalId: '12345***',
  status: 'ACTIVE' as const,
  contacts: [{ id: 'c1', contactType: 'WHATSAPP', value: '70000000', isPrimary: true }],
  locations: [{ id: 'l1', locationType: 'HOME', address: 'Villa Fátima s/n', zone: 'Norte' }],
  relations: [
    {
      id: 'g1',
      relatedName: 'Luis Vargas',
      relationshipType: 'GUARANTOR',
      isContactable: true,
      contacts: [{ id: 'gc1', contactType: 'PHONE', value: '71111111', isPrimary: true }],
      locations: [],
    },
  ],
};

describe('diffCliente', () => {
  it('sin tocar nada no hay una sola llamada que hacer', () => {
    const before = hydrateCliente(DETALLE);
    const ops = diffCliente(before, hydrateCliente(DETALLE));
    expect(hasChanges(ops)).toBe(false);
  });

  it('cambiar el nombre manda sólo ese campo', () => {
    const before = hydrateCliente(DETALLE);
    const after = { ...before, firstName: 'Anita', lastName: 'Ruiz' };
    const ops = diffCliente(before, after);
    expect(ops.client).toEqual({ firstName: 'Anita' });
    expect(hasChanges(ops)).toBe(true);
  });

  /**
   * 🔴 El documento estaba excluido del diff: el formulario lo dibujaba editable, se corregía un CI
   * mal tipeado y **no pasaba nada** — y si era el único cambio, ni se encendía el botón de guardar.
   * Es el dato por el que el cobrador busca a la persona; tiene que poder arreglarse.
   */
  it('corregir el documento viaja como cambio del cliente', () => {
    const before = hydrateCliente({ ...DETALLE, nationalId: '12345678' });
    const after = { ...before, nationalId: '12345679' };
    const ops = diffCliente(before, after);
    expect(ops.client).toEqual({ nationalId: '12345679' });
    expect(hasChanges(ops)).toBe(true);
  });

  it('marcarle el punto a la dirección importada la ACTUALIZA, no crea otra', () => {
    const before = hydrateCliente(DETALLE);
    const after = {
      ...before,
      locations: [{ ...before.locations[0]!, latitude: '-17.78', longitude: '-63.18', coordMode: 'map' as const }],
    };
    const ops = diffCliente(before, after);
    expect(ops.locations.update.map((l) => l.serverId)).toEqual(['l1']);
    expect(ops.locations.add).toEqual([]);
    expect(ops.locations.removeIds).toEqual([]);
  });

  it('una fila sin serverId es nueva; la que desaparece se borra por id', () => {
    const before = hydrateCliente(DETALLE);
    const after = {
      ...before,
      contacts: [{ id: 'nuevo', contactType: 'PHONE' as const, value: '72222222', hasWhatsApp: false, isPrimary: false }],
    };
    const ops = diffCliente(before, after);
    expect(ops.contacts.add).toHaveLength(1);
    expect(ops.contacts.removeIds).toEqual(['c1']);
  });

  it('el teléfono de un garante que ya existía viaja con su relationId', () => {
    const before = hydrateCliente(DETALLE);
    const rel = before.relations[0]!;
    const after = {
      ...before,
      relations: [{ ...rel, contacts: [{ ...rel.contacts[0]!, value: '79999999' }] }],
    };
    const ops = diffCliente(before, after);
    expect(ops.relationContacts.update).toHaveLength(1);
    expect(ops.relationContacts.update[0]!.relationId).toBe('g1');
  });

  it('un garante nuevo se crea entero (sus teléfonos van adentro, no aparte)', () => {
    const before = hydrateCliente(DETALLE);
    const after = {
      ...before,
      relations: [
        ...before.relations,
        { id: 'r9', relatedName: 'Nuevo', relationshipType: 'FAMILY' as const, gender: '', isContactable: true, notes: '', contacts: [{ id: 'x', contactType: 'PHONE' as const, value: '73333333', hasWhatsApp: true, isPrimary: true }], locations: [] },
      ],
    };
    const ops = diffCliente(before, after);
    expect(ops.relations.add).toHaveLength(1);
    expect(ops.relationContacts.add).toEqual([]); // no se duplica: va dentro del alta del garante
  });

  it('editar al garante manda el garante, no sus teléfonos', () => {
    const before = hydrateCliente(DETALLE);
    const after = { ...before, relations: [{ ...before.relations[0]!, relatedName: 'Luis A. Vargas' }] };
    const ops = diffCliente(before, after);
    expect(ops.relations.update.map((r) => r.serverId)).toEqual(['g1']);
    expect(ops.relationContacts.update).toEqual([]);
  });

  it('cambiar a qué préstamos garantiza es un cambio del garante', () => {
    const before = hydrateCliente({ ...DETALLE, relations: [{ ...DETALLE.relations[0]!, creditIds: ['k1'] }] });
    const after = { ...before, relations: [{ ...before.relations[0]!, creditIds: ['k1', 'k2'] }] };
    const ops = diffCliente(before, after);
    expect(ops.relations.update.map((r) => r.creditIds)).toEqual([['k1', 'k2']]);
  });

  it('🔴 el MISMO vínculo en otro orden NO es un cambio', () => {
    // El server devuelve los vínculos en el orden que quiere y la pantalla en el que se fueron
    // tildando: comparando sin ordenar, abrir el formulario y guardar sin tocar nada mandaba un
    // PATCH por cada garante.
    const before = hydrateCliente({ ...DETALLE, relations: [{ ...DETALLE.relations[0]!, creditIds: ['k1', 'k2'] }] });
    const after = { ...before, relations: [{ ...before.relations[0]!, creditIds: ['k2', 'k1'] }] };
    expect(hasChanges(diffCliente(before, after))).toBe(false);
  });

  it('desvincular el último préstamo sí se guarda', () => {
    // `[]` tiene significado: «no respalda ninguno». Tratándolo como «no vino nada», sacar el último
    // no se podría guardar nunca.
    const before = hydrateCliente({ ...DETALLE, relations: [{ ...DETALLE.relations[0]!, creditIds: ['k1'] }] });
    const after = { ...before, relations: [{ ...before.relations[0]!, creditIds: [] }] };
    expect(diffCliente(before, after).relations.update).toHaveLength(1);
  });

  it('la garantía nueva se crea; la vacía no viaja', () => {
    const before = hydrateCliente(DETALLE);
    const after = {
      ...before,
      collaterals: [
        { id: 'n1', type: 'VEHICULO', description: 'Moto Honda roja 2019', estimatedValue: '4500', currency: 'BOB', photoUrls: [], creditIds: ['k1'] },
        { id: 'n2', type: '', description: '   ', estimatedValue: '', currency: '', photoUrls: [], creditIds: [] },
      ],
    };
    const ops = diffCliente(before, after);
    expect(ops.collaterals.add.map((g) => g.description)).toEqual(['Moto Honda roja 2019']);
  });

  it('editar la garantía la ACTUALIZA, no crea otra', () => {
    const before = hydrateCliente({
      ...DETALLE,
      collaterals: [{ id: 'gar1', type: 'VEHICULO', description: 'Moto Honda', estimatedValue: 4500, currency: 'BOB', creditIds: ['k1'] }],
    });
    const after = { ...before, collaterals: [{ ...before.collaterals[0]!, description: 'Moto Honda roja 2019' }] };
    const ops = diffCliente(before, after);
    expect(ops.collaterals.add).toEqual([]);
    expect(ops.collaterals.update.map((g) => g.serverId)).toEqual(['gar1']);
  });
});
