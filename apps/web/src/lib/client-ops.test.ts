import { describe, it, expect } from 'vitest';
import { diffCliente, hydrateCliente, type ClientDetail } from '@kobrax/shared';
import { opsRequests } from './client-ops';

/** Como vuelve del server con `reveal=true`, que es como se carga la edición. */
const DETALLE: ClientDetail = {
  id: 'cl-1',
  clientType: 'PERSON',
  firstName: 'Ana',
  lastName: 'Ruiz',
  nationalId: '12345678',
  status: 'ACTIVE',
  contacts: [{ id: 'ct-1', contactType: 'PHONE', value: '70012323', isPrimary: true }],
  locations: [{ id: 'lo-1', locationType: 'HOME', address: 'Calle Falsa 123' }],
  relations: [
    {
      id: 're-1',
      relatedName: 'Carlos',
      relationshipType: 'GUARANTOR',
      isContactable: true,
      contacts: [{ id: 'ct-2', contactType: 'PHONE', value: '71111111', isPrimary: false }],
      locations: [],
    },
  ],
};

const base = () => hydrateCliente(DETALLE);
const requests = (after: ReturnType<typeof base>) => opsRequests('cl-1', diffCliente(base(), after));

describe('opsRequests', () => {
  it('sin cambios no manda nada: guardar sin tocar no llama a nadie', () => {
    expect(requests(base())).toEqual([]);
  });

  it('un campo del cliente es un PATCH al cliente, y nada más', () => {
    const after = { ...base(), riskSegment: 'ALTO' };
    expect(requests(after)).toEqual([{ path: '/clients/cl-1', method: 'PATCH', body: { riskSegment: 'ALTO' } }]);
  });

  /**
   * Lo que se borra va **primero**. Si una fila se quita y otra se agrega en el mismo guardado,
   * hacerlo al revés deja las dos vivas un instante — y si la segunda falla, con la vieja que ya
   * se quería sacar.
   */
  it('borra antes de agregar', () => {
    const form = base();
    const after = {
      ...form,
      contacts: [{ id: 'nuevo', contactType: 'PHONE' as const, value: '79999999', hasWhatsApp: true, isPrimary: true }],
    };
    const paths = requests(after).map((r) => `${r.method} ${r.path}`);
    expect(paths).toEqual(['DELETE /clients/cl-1/contacts/ct-1', 'POST /clients/cl-1/contacts']);
  });

  it('el teléfono con WhatsApp viaja como tipo WHATSAPP, no como una bandera', () => {
    const form = base();
    const after = { ...form, contacts: [{ ...form.contacts[0]!, hasWhatsApp: true }] };
    const [req] = requests(after);
    expect(req?.method).toBe('PATCH');
    expect(req?.body).toMatchObject({ contactType: 'WHATSAPP', value: '70012323' });
  });

  it('un garante nuevo se crea con sus teléfonos adentro, en una sola llamada', () => {
    const form = base();
    const after = {
      ...form,
      relations: [
        ...form.relations,
        {
          id: 'g-nuevo',
          relatedName: 'Marta',
          relationshipType: 'FAMILY' as const,
          gender: '',
          isContactable: true,
          notes: '',
          contacts: [{ id: 'c-n', contactType: 'PHONE' as const, value: '72222222', hasWhatsApp: false, isPrimary: true }],
          locations: [],
        },
      ],
    };
    const reqs = requests(after);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ path: '/clients/cl-1/relations', method: 'POST' });
    expect(reqs[0]!.body).toMatchObject({
      relatedName: 'Marta',
      contacts: [{ contactType: 'PHONE', value: '72222222' }],
    });
  });

  // Los de un garante que YA existía no pueden viajar dentro de su alta: no hay alta. Van por su
  // propia ruta, y con `relationId` o el teléfono le quedaría colgado al cliente.
  it('el teléfono nuevo de un garante existente lleva su relationId', () => {
    const form = base();
    const rel = form.relations[0]!;
    const after = {
      ...form,
      relations: [
        {
          ...rel,
          contacts: [...rel.contacts, { id: 'c-n', contactType: 'PHONE' as const, value: '73333333', hasWhatsApp: false, isPrimary: false }],
        },
      ],
    };
    const reqs = requests(after);
    expect(reqs).toEqual([
      {
        path: '/clients/cl-1/contacts',
        method: 'POST',
        body: { contactType: 'PHONE', value: '73333333', isPrimary: false, relationId: 're-1' },
      },
    ]);
  });

  it('el PATCH de un garante no arrastra sus sub-recursos', () => {
    const form = base();
    const after = { ...form, relations: [{ ...form.relations[0]!, relatedName: 'Carlos Mamani' }] };
    const [req] = requests(after);
    expect(req?.path).toBe('/clients/cl-1/relations/re-1');
    expect(req?.body).not.toHaveProperty('contacts');
    expect(req?.body).not.toHaveProperty('locations');
  });

  /**
   * Agregar una fila y no escribirla es arrepentirse, no cargar un dato en blanco. El alta ya las
   * filtraba (`mapContacts`); la edición las mandaba igual, y el `POST` de una ubicación no exige
   * contenido — o sea que creaba una dirección sin dirección.
   */
  it('una fila nueva y vacía no se manda', () => {
    const form = base();
    const after = {
      ...form,
      locations: [
        ...form.locations,
        {
          id: 'vacia',
          locationType: 'HOME' as const,
          address: '',
          zone: '',
          latitude: '',
          longitude: '',
          coordMode: 'manual' as const,
          referenceNotes: '',
          photoUrls: [],
        },
      ],
      contacts: [...form.contacts, { id: 'vacio', contactType: 'PHONE' as const, value: '   ', hasWhatsApp: true, isPrimary: false }],
      relations: [
        ...form.relations,
        { id: 'sin-nombre', relatedName: '', relationshipType: 'GUARANTOR' as const, gender: '', isContactable: true, notes: '', contacts: [], locations: [] },
      ],
    };
    expect(requests(after)).toEqual([]);
  });
});
