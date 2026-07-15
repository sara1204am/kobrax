import { buildClientePayload, canSubmitCliente, emptyContact, emptyLocation, emptyRelation, initialCliente } from './cliente-form';

describe('cliente-form', () => {
  it('habilita guardar solo con nombre + apellido + un teléfono con valor', () => {
    let s = initialCliente(); // trae un contacto teléfono vacío
    expect(canSubmitCliente(s)).toBe(false);
    s = { ...s, firstName: 'Ana', lastName: 'Ruiz' };
    expect(canSubmitCliente(s)).toBe(false); // el teléfono sigue vacío
    s = { ...s, contacts: [{ ...s.contacts[0]!, value: '70000000' }] };
    expect(canSubmitCliente(s)).toBe(true);
  });

  it('un teléfono con WhatsApp viaja como WHATSAPP; el email como EMAIL', () => {
    const s = {
      ...initialCliente(),
      firstName: 'Ana',
      lastName: 'Ruiz',
      contacts: [
        { ...emptyContact('a'), value: '70000000', hasWhatsApp: true, isPrimary: true },
        { ...emptyContact('b'), contactType: 'EMAIL' as const, value: 'ana@x.com', hasWhatsApp: false },
        { ...emptyContact('c'), value: '', hasWhatsApp: false }, // vacío → se descarta
      ],
    };
    const p = buildClientePayload(s);
    expect(p.contacts).toEqual([
      { contactType: 'WHATSAPP', value: '70000000', isPrimary: true },
      { contactType: 'EMAIL', value: 'ana@x.com', isPrimary: false },
    ]);
  });

  it('descarta ubicaciones vacías y relaciones sin nombre', () => {
    const s = {
      ...initialCliente(),
      firstName: 'Ana',
      lastName: 'Ruiz',
      contacts: [{ ...emptyContact('a'), value: '7' }],
      locations: [
        { ...emptyLocation('l1'), zone: 'Sur', latitude: -17.7, photoUrls: ['u1'] },
        { ...emptyLocation('l2') }, // vacía → fuera
      ],
      relations: [
        { ...emptyRelation('r1'), relatedName: 'Carlos', phone: '71234567' },
        { ...emptyRelation('r2') }, // sin nombre → fuera
      ],
    };
    const p = buildClientePayload(s);
    expect(p.locations).toHaveLength(1);
    expect(p.locations![0]).toMatchObject({ zone: 'Sur', latitude: -17.7, photoUrls: ['u1'], locationType: 'HOME' });
    expect(p.relations).toHaveLength(1);
    expect(p.relations![0]).toMatchObject({ relatedName: 'Carlos', phone: '71234567', relationshipType: 'GUARANTOR' });
  });

  it('manda los campos de identidad (tipo, género, segmento, estado)', () => {
    const s = { ...initialCliente(), firstName: 'Ana', lastName: 'Ruiz', clientType: 'COMPANY' as const, gender: 'F', riskSegment: 'HIGH', businessName: 'Acme', contacts: [{ ...emptyContact('a'), value: '7' }] };
    const p = buildClientePayload(s);
    expect(p).toMatchObject({ clientType: 'COMPANY', gender: 'F', riskSegment: 'HIGH', businessName: 'Acme', status: 'ACTIVE' });
  });
});
