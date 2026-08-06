/**
 * El motor de sync. Acá se prueba lo que puede costar plata o trabajo del cobrador:
 * que un fallo no borre, que un ítem trabado no bloquee a los que siguen, que sin red se corte
 * en vez de gastar batería, y que dos drenajes simultáneos no suban lo mismo dos veces.
 */
const mockCola: { id: number; action: { kind: string }; attempts: number; lastError: string | null; createdAt: number }[] = [];
const mockOps: string[] = [];
const mockSend: { result: Record<string, unknown> } = { result: { status: 'ok' } };

jest.mock('../db', () => ({
  dequeue: jest.fn(async (id: number) => {
    mockOps.push(`dequeue:${id}`);
    const i = mockCola.findIndex((x) => x.id === id);
    if (i >= 0) mockCola.splice(i, 1);
  }),
  markFailed: jest.fn(async (id: number, err: string) => {
    mockOps.push(`markFailed:${id}:${err}`);
    const row = mockCola.find((x) => x.id === id);
    if (row) row.attempts += 1;
  }),
  pendingCount: jest.fn(async () => mockCola.length),
}));

jest.mock('./queue', () => ({
  pendingActions: jest.fn(async () => [...mockCola]),
  send: jest.fn(async (action: { kind: string }) => {
    mockOps.push(`send:${action.kind}`);
    return mockSend.result;
  }),
}));

import { drain } from './sync.service';

const item = (id: number, kind = 'payment', attempts = 0) => ({
  id,
  action: { kind },
  attempts,
  lastError: null,
  createdAt: id,
});

beforeEach(() => {
  mockCola.length = 0;
  mockOps.length = 0;
  mockSend.result = { status: 'ok' };
});

describe('drain', () => {
  it('lo que sube, se borra de la cola', async () => {
    mockCola.push(item(1), item(2));
    const r = await drain('u1');
    expect(r.sent).toBe(2);
    expect(mockOps).toContain('dequeue:1');
    expect(mockOps).toContain('dequeue:2');
  });

  // Es LA regla del módulo: un error nunca puede hacer desaparecer un pago del teléfono.
  it('un error del servidor NO borra: cuenta el intento', async () => {
    mockCola.push(item(1));
    mockSend.result = { status: 'error', message: 'monto inválido' };
    const r = await drain('u1');
    expect(r.failed).toBe(1);
    expect(mockOps.some((o) => o.startsWith('markFailed:1'))).toBe(true);
    expect(mockOps.some((o) => o.startsWith('dequeue'))).toBe(false);
  });

  it('sin red corta en el primero: los que siguen tampoco van a salir', async () => {
    mockCola.push(item(1), item(2), item(3));
    mockSend.result = { status: 'offline' };
    const r = await drain('u1');
    expect(r.stopped).toBe('offline');
    expect(mockOps.filter((o) => o.startsWith('send')).length).toBe(1);
  });

  it('una sesión vencida también corta, sin marcar el ítem como fallado', async () => {
    mockCola.push(item(1));
    mockSend.result = { status: 'auth' };
    const r = await drain('u1');
    expect(r.stopped).toBe('auth');
    expect(mockOps.some((o) => o.startsWith('markFailed'))).toBe(false);
  });

  // Si un ítem roto se reintentara para siempre, tendría trabada la cola y el pago de atrás
  // no subiría nunca.
  it('un ítem que ya agotó sus intentos se saltea y deja pasar a los demás', async () => {
    mockCola.push(item(1, 'visit', 3), item(2, 'payment', 0));
    await drain('u1');
    expect(mockOps).toContain('send:payment');
    expect(mockOps).not.toContain('send:visit');
  });

  it('reintentar a mano ignora el techo de intentos', async () => {
    mockCola.push(item(1, 'visit', 5));
    await drain('u1', { force: true });
    expect(mockOps).toContain('send:visit');
  });

  // Dos drenajes en paralelo subirían la misma acción dos veces; la idempotencia salva al pago,
  // pero no a una visita o a una gestión.
  it('dos drenajes simultáneos no envían lo mismo dos veces', async () => {
    mockCola.push(item(1));
    const [a, b] = await Promise.all([drain('u1'), drain('u1')]);
    expect(mockOps.filter((o) => o.startsWith('send')).length).toBe(1);
    expect(a.sent + b.sent).toBe(1);
  });
});
