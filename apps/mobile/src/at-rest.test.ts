const mockStore = new Map<string, string>();
let mockRandomCounter = 0;
let mockStoreDown = false;

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: jest.fn(async (k: string) => {
    if (mockStoreDown) throw new Error('keystore no disponible');
    return mockStore.get(k) ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockStoreDown) throw new Error('keystore no disponible');
    mockStore.set(k, v);
  }),
}));
jest.mock('expo-crypto', () => ({
  // Determinista pero distinto en cada llamada: el nonce no puede repetirse.
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + ++mockRandomCounter) % 256),
}));

import { ENC_PREFIX, isSealed, open, resetKeyForTests, seal } from './at-rest';

beforeEach(() => {
  mockStore.clear();
  mockStoreDown = false;
  mockRandomCounter = 0;
  resetKeyForTests();
});

describe('cifrado en reposo', () => {
  it('cifra y descifra (ida y vuelta) sin dejar el texto en claro', async () => {
    const plain = JSON.stringify({ nombre: 'Ana Pérez', telefono: '70012345', monto: 450 });
    const sealed = (await seal(plain))!;
    expect(sealed.startsWith(ENC_PREFIX)).toBe(true);
    expect(sealed).not.toContain('Ana');
    expect(sealed).not.toContain('70012345');
    expect(await open(sealed)).toBe(plain);
  });

  it('el mismo texto cifrado dos veces da resultados distintos (nonce nuevo)', async () => {
    const a = await seal('hola');
    const b = await seal('hola');
    expect(a).not.toBe(b);
  });

  it('la llave se crea una vez, vive en el almacén seguro y se reutiliza', async () => {
    await seal('x');
    const key = mockStore.get('kobrax.db.key')!;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    resetKeyForTests();
    const sealed = (await seal('y'))!;
    expect(mockStore.get('kobrax.db.key')).toBe(key);
    expect(await open(sealed)).toBe('y');
  });

  it('una fila alterada NO se descifra (integridad)', async () => {
    const sealed = (await seal('cobro de 450'))!;
    const last = sealed.slice(-1) === '0' ? '1' : '0';
    expect(await open(sealed.slice(0, -1) + last)).toBeNull();
  });

  it('una fila anterior al cifrado se lee tal cual (no se pierde la cola vieja)', async () => {
    expect(isSealed('{"a":1}')).toBe(false);
    expect(await open('{"a":1}')).toBe('{"a":1}');
  });

  it('sin almacén seguro no hay llave: no cifra y lo cifrado no abre (nunca inventa)', async () => {
    const sealed = (await seal('algo'))!;
    resetKeyForTests();
    mockStoreDown = true;
    expect(await seal('otro')).toBeNull();
    expect(await open(sealed)).toBeNull();
  });

  it('con otra llave el dato no abre', async () => {
    const sealed = (await seal('privado'))!;
    mockStore.clear();
    resetKeyForTests();
    expect(await open(sealed)).toBeNull();
  });
});
