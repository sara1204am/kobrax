/**
 * Qué de «Editar cliente» puede esperar señal. Lo que se encola es lo repetible sin duplicar; si el guardado trae
 * una alta (que el server no puede reconocer) no se encola NADA — subir sólo una parte sería perder el resto.
 */
import type { ClienteOps } from '@kobrax/shared';
import { opsToActions, queueableOps } from './cliente-queue';

const vacio = <T>() => ({ add: [] as T[], update: [] as T[], removeIds: [] as string[] });
const ops = (over: Partial<ClienteOps> = {}): ClienteOps => ({
  contacts: vacio(),
  locations: vacio(),
  relations: vacio(),
  collaterals: vacio(),
  relationContacts: vacio(),
  relationLocations: vacio(),
  ...over,
});

const contacto = { serverId: 'ct1', contactType: 'PHONE', value: '70012345', isPrimary: false, key: 'k' } as never;
const ubicacion = {
  serverId: 'lc1',
  locationType: 'HOME',
  address: 'Calle 1',
  zone: '',
  latitude: '',
  longitude: '',
  referenceNotes: '',
  photoUrls: [],
  key: 'k',
} as never;

describe('queueableOps', () => {
  it('datos sueltos, cambios y bajas de teléfonos/direcciones se pueden encolar', () => {
    expect(
      queueableOps(
        ops({
          client: { firstName: 'Ana' },
          contacts: { add: [], update: [contacto], removeIds: ['ct2'] },
          locations: { add: [], update: [ubicacion], removeIds: ['lc2'] },
        }),
      ),
    ).toBe(true);
  });

  it('un teléfono o dirección NUEVOS sí: la cola los busca antes de crearlos y no duplica', () => {
    const nuevo = { contactType: 'PHONE', value: '70099999', hasWhatsApp: false, isPrimary: false, key: 'n' } as never;
    const casa = { locationType: 'HOME', address: 'Av. Siempre Viva 1', zone: '', latitude: '', longitude: '', referenceNotes: '', photoUrls: [], key: 'n' } as never;
    expect(queueableOps(ops({ contacts: { add: [nuevo], update: [], removeIds: [] } }))).toBe(true);
    expect(queueableOps(ops({ locations: { add: [casa], update: [], removeIds: [] } }))).toBe(true);
  });

  it('lo que el endpoint no lleva sí frena el guardado entero: correo, dirección con fotos o sin texto', () => {
    const correo = { contactType: 'EMAIL', value: 'a@b.c', hasWhatsApp: false, key: 'n' } as never;
    const conFoto = { locationType: 'HOME', address: 'Calle 2', zone: '', latitude: '', longitude: '', referenceNotes: '', photoUrls: ['/api/uploads/x.jpg'], key: 'n' } as never;
    const sinTexto = { locationType: 'HOME', address: '  ', zone: '', latitude: '', longitude: '', referenceNotes: '', photoUrls: [], key: 'n' } as never;
    expect(queueableOps(ops({ contacts: { add: [correo], update: [], removeIds: [] } }))).toBe(false);
    expect(queueableOps(ops({ locations: { add: [conFoto], update: [], removeIds: [] } }))).toBe(false);
    expect(queueableOps(ops({ locations: { add: [sinTexto], update: [], removeIds: [] } }))).toBe(false);
  });

  it('garantes y garantías (altas, cambios o bajas) tampoco', () => {
    expect(queueableOps(ops({ relations: { add: [], update: [], removeIds: ['r1'] } }))).toBe(false);
    expect(queueableOps(ops({ collaterals: { add: [], update: [contacto], removeIds: [] } }))).toBe(false);
    expect(queueableOps(ops({ relationContacts: { add: [], update: [], removeIds: ['x'] } }))).toBe(false);
    expect(queueableOps(ops({ relationLocations: { add: [], update: [contacto], removeIds: [] } }))).toBe(false);
  });

  it('sin cambios es trivialmente encolable (nada que encolar)', () => {
    expect(queueableOps(ops())).toBe(true);
  });
});

describe('opsToActions', () => {
  it('traduce al orden de applyOps: datos, bajas, cambios', () => {
    const actions = opsToActions(
      'cl1',
      ops({
        client: { firstName: 'Ana', status: 'ACTIVE' },
        contacts: { add: [], update: [contacto], removeIds: ['ct-baja'] },
        locations: { add: [], update: [ubicacion], removeIds: ['lc-baja'] },
      }),
    );
    expect(actions.map((a) => (a.kind === 'client.update' ? a.kind : `${a.kind}:${(a as { op: string }).op}`))).toEqual([
      'client.update',
      'client.contact:remove',
      'client.location:remove',
      'client.contact:update',
      'client.location:update',
    ]);
  });

  it('el PATCH de datos lleva exactamente lo que cambió', () => {
    const [a] = opsToActions('cl1', ops({ client: { firstName: 'Ana' } }));
    expect(a).toEqual({ kind: 'client.update', clientId: 'cl1', patch: { firstName: 'Ana' } });
  });

  it('el cambio de teléfono apunta al id del server y lleva el valor ya armado', () => {
    const [a] = opsToActions('cl1', ops({ contacts: { add: [], update: [contacto], removeIds: [] } }));
    expect(a).toMatchObject({ kind: 'client.contact', op: 'update', clientId: 'cl1', contactId: 'ct1' });
    expect((a as { input: { value: string } }).input.value).toBe('70012345');
  });

  it('las altas van al final, con id provisional, y WhatsApp se respeta', () => {
    const nuevo = { contactType: 'PHONE', value: ' 70099999 ', hasWhatsApp: true, isPrimary: false, key: 'n' } as never;
    const casa = { locationType: 'WORK', address: 'Calle 9', zone: 'Sur', latitude: '-19.5', longitude: '-65.7', referenceNotes: '', photoUrls: [], key: 'n' } as never;
    const actions = opsToActions('cl1', ops({ client: { firstName: 'Ana' }, contacts: { add: [nuevo], update: [], removeIds: [] }, locations: { add: [casa], update: [], removeIds: [] } }));
    expect(actions.map((a) => a.kind)).toEqual(['client.update', 'client.contact', 'client.location']);
    expect(actions[1]).toMatchObject({ op: 'add', clientId: 'cl1', input: { contactType: 'WHATSAPP', value: '70099999' } });
    expect((actions[1] as { localId: string }).localId).toMatch(/^local:/);
    expect(actions[2]).toMatchObject({ op: 'add', input: { locationType: 'WORK', address: 'Calle 9', zone: 'Sur', latitude: -19.5, longitude: -65.7 } });
  });

  it('sin cambios no genera nada', () => {
    expect(opsToActions('cl1', ops())).toEqual([]);
  });
});

describe('perfil de ingreso (F4/13 · E3)', () => {
  it('es un valor fijo: no frena el guardado sin señal', () => {
    expect(queueableOps(ops({ income: { occupationCode: 'TRANSPORT', incomeCycle: 'WEEKLY' } }))).toBe(true);
    expect(queueableOps(ops({ income: null }))).toBe(true);
  });

  it('se traduce a una sola acción client.income, justo después de los datos del cliente', () => {
    const actions = opsToActions('cl1', ops({ client: { firstName: 'Ana' }, income: { occupationCode: 'MERCHANT' } }));
    expect(actions.map((a) => a.kind)).toEqual(['client.update', 'client.income']);
    expect(actions[1]).toEqual({ kind: 'client.income', clientId: 'cl1', profile: { occupationCode: 'MERCHANT' } });
  });

  it('🔴 vaciar el perfil encola null: es la forma de borrarlo', () => {
    expect(opsToActions('cl1', ops({ income: null }))).toEqual([{ kind: 'client.income', clientId: 'cl1', profile: null }]);
  });

  it('sin cambios en el perfil no genera nada', () => {
    expect(opsToActions('cl1', ops())).toEqual([]);
  });
});
