import { isForUser, pushTarget, readPushData, PUSH_TYPES } from './push-target';

const UID = '11111111-2222-4333-8444-555555555555';
const NID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const AID = '22222222-3333-4444-8555-666666666666';
const CID = '33333333-4444-4555-8666-777777777777';

const base = { type: 'AGENDA_ASSIGNED', nid: NID, uid: UID };

describe('push-target · el push no es fuente de verdad', () => {
  it('lee un push válido con sus ids', () => {
    expect(readPushData({ ...base, aid: AID })).toEqual({ type: 'AGENDA_ASSIGNED', nid: NID, uid: UID, aid: AID, rid: undefined, cid: undefined });
  });

  it('🔴 lo que no es un push de Kobrax (o viene mal formado) se descarta', () => {
    expect(readPushData(null)).toBeNull();
    expect(readPushData('x')).toBeNull();
    expect(readPushData({ itemId: AID })).toBeNull(); // un aviso local de agenda
    expect(readPushData({ ...base, type: 'SYSTEM' })).toBeNull(); // tipo que no sale por push
    expect(readPushData({ ...base, uid: 'no-uuid' })).toBeNull();
    expect(readPushData({ type: 'ROUTE_ASSIGNED', uid: UID })).toBeNull(); // sin nid
  });

  it('🔴 un id que no es UUID se ignora: nunca llega a la ruta de navegación', () => {
    const d = readPushData({ ...base, aid: '../../cuenta' })!;
    expect(d.aid).toBeUndefined();
    expect(pushTarget(d)).toBe('/(tabs)/agenda');
  });

  it('el aviso es de quien tiene la sesión: de otra persona no se muestra ni se abre', () => {
    const d = readPushData(base)!;
    expect(isForUser(d, UID)).toBe(true);
    expect(isForUser(d, 'otro-usuario')).toBe(false);
    expect(isForUser(d, null)).toBe(false);
    expect(isForUser(d, undefined)).toBe(false);
  });

  it('cada tipo lleva a su pantalla', () => {
    const go = (type: string, extra: object = {}) => pushTarget(readPushData({ ...base, type, ...extra })!);
    expect(go('AGENDA_ASSIGNED', { aid: AID })).toBe(`/agenda/${AID}`);
    expect(go('AGENDA_CHANGED', { aid: AID })).toBe(`/agenda/${AID}`);
    expect(go('PROMISE_DUE', { cid: CID })).toBe(`/mora/${CID}`);
    expect(go('ROUTE_ASSIGNED')).toBe('/(tabs)/rutas');
    expect(go('ROUTE_CHANGE_REQUESTED')).toBe('/(tabs)/rutas');
    expect(go('ROUTE_CHANGE_DECIDED')).toBe('/(tabs)/rutas');
  });

  it('sin id del recurso cae a la lista de su módulo', () => {
    expect(pushTarget(readPushData({ ...base, type: 'AGENDA_CHANGED' })!)).toBe('/(tabs)/agenda');
    expect(pushTarget(readPushData({ ...base, type: 'PROMISE_DUE' })!)).toBe('/(tabs)/cobranza');
  });

  it('son exactamente los seis tipos que el servidor manda por push', () => {
    expect([...PUSH_TYPES].sort()).toEqual(
      ['AGENDA_ASSIGNED', 'AGENDA_CHANGED', 'PROMISE_DUE', 'ROUTE_ASSIGNED', 'ROUTE_CHANGE_DECIDED', 'ROUTE_CHANGE_REQUESTED'].sort(),
    );
  });
});
