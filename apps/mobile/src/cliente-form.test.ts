import { buildClientePayload, canSubmitCliente, initialCliente } from './cliente-form';

describe('cliente-form', () => {
  it('habilita guardar solo con nombre + apellido + teléfono', () => {
    let s = initialCliente();
    expect(canSubmitCliente(s)).toBe(false);
    s = { ...s, firstName: 'Ana', lastName: 'Ruiz' };
    expect(canSubmitCliente(s)).toBe(false); // falta teléfono
    s = { ...s, phone: '70000000' };
    expect(canSubmitCliente(s)).toBe(true);
  });

  it('manda el contacto como WHATSAPP cuando la casilla está marcada y sin ubicación si está vacía', () => {
    const s = { ...initialCliente(), firstName: 'Ana', lastName: 'Ruiz', phone: '70000000' };
    const p = buildClientePayload(s);
    expect(p.contacts).toEqual([{ contactType: 'WHATSAPP', value: '70000000', isPrimary: true }]);
    expect(p.preferredContactChannel).toBe('WHATSAPP');
    expect(p.location).toBeUndefined();
  });

  it('incluye la ubicación (con foto) solo si hay algún dato de ubicación', () => {
    const s = {
      ...initialCliente(),
      firstName: 'Ana',
      lastName: 'Ruiz',
      phone: '7',
      hasWhatsapp: false,
      zone: 'Sur',
      latitude: -17.7,
      photoUrl: 'https://x/f.jpg',
    };
    const p = buildClientePayload(s);
    expect(p.contacts![0]!.contactType).toBe('PHONE');
    expect(p.location).toEqual({
      address: undefined,
      zone: 'Sur',
      latitude: -17.7,
      longitude: undefined,
      referenceNotes: undefined,
      photoUrls: ['https://x/f.jpg'],
    });
  });
});
