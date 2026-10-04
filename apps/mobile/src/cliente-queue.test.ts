/**
 * Qué de «Editar cliente» puede esperar señal. Lo que se encola es lo repetible sin duplicar; si el guardado trae
 * una alta (que el server no puede reconocer) no se encola NADA — subir sólo una parte sería perder el resto.
 */
import type { ClienteOps } from './cliente-diff';
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

  it('un teléfono o dirección NUEVOS no: el POST no acepta id y duplicaría al reintentar', () => {
    expect(queueableOps(ops({ contacts: { add: [contacto], update: [], removeIds: [] } }))).toBe(false);
    expect(queueableOps(ops({ locations: { add: [ubicacion], update: [], removeIds: [] } }))).toBe(false);
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

  it('sin cambios no genera nada', () => {
    expect(opsToActions('cl1', ops())).toEqual([]);
  });
});
