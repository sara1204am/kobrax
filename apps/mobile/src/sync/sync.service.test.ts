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
  markRejected: jest.fn(async (id: number, err: string) => {
    mockOps.push(`markRejected:${id}:${err}`);
    const row = mockCola.find((x) => x.id === id);
    if (row) row.attempts = 99;
  }),
  pendingCount: jest.fn(async () => mockCola.length),
}));

const mockSendBehavior: { throws?: Error } = {};

jest.mock('./optimistic', () => ({
  writeProvisionalClient: jest.fn(async (input: { id?: string }) => void mockOps.push(`provisionalClient:${input.id}`)),
  writeProvisionalCredit: jest.fn(async (input: { id?: string }) => void mockOps.push(`provisionalCredit:${input.id}`)),
}));

jest.mock('./queue', () => ({
  enqueue: jest.fn(async () => true),
  // Los ítems viejos reciben un id estable ANTES de enviarse: el mock lo deja visible en el registro.
  stabilize: jest.fn(async (rowId: number, action: unknown) => {
    mockOps.push(`stabilize:${rowId}`);
    return action;
  }),
  pendingActions: jest.fn(async () => [...mockCola]),
  send: jest.fn(async (action: { kind: string }) => {
    mockOps.push(`send:${action.kind}`);
    if (mockSendBehavior.throws) throw mockSendBehavior.throws;
    return mockSend.result;
  }),
}));

jest.mock('../route-draft', () => ({
  flushPendingDraft: jest.fn(async () => {
    mockOps.push('flushDraft');
    return 'nothing';
  }),
}));

import { drain, queueForLater } from './sync.service';

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
  delete mockSendBehavior.throws;
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

  // Un 4xx no se arregla reintentando: queda a la vista como rechazado, y tampoco se borra.
  it('un rechazo definitivo del servidor se marca rechazado, no se borra ni se reintenta solo', async () => {
    mockCola.push(item(1));
    mockSend.result = { status: 'error', message: 'La fecha del pago no puede ser futura', permanent: true };
    const r = await drain('u1');
    expect(r.failed).toBe(1);
    expect(mockOps).toContain('markRejected:1:La fecha del pago no puede ser futura');
    expect(mockOps.some((o) => o.startsWith('markFailed') || o.startsWith('dequeue'))).toBe(false);
    mockOps.length = 0;
    await drain('u1');
    expect(mockOps.some((o) => o.startsWith('send'))).toBe(false); // superó el techo: no sale solo
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

  // El recorrido armado en el mapa sin señal se quedaba en el teléfono hasta que el cobrador
  // volviera a la pantalla y tocara un pin.
  it('también sincroniza el borrador de ruta pendiente', async () => {
    await drain('u1');
    expect(mockOps).toContain('flushDraft');
  });

  it('si se cortó por falta de red, ni intenta el borrador', async () => {
    mockCola.push(item(1));
    mockSend.result = { status: 'offline' };
    await drain('u1');
    expect(mockOps).not.toContain('flushDraft');
  });

  // Un ítem que explota (archivo ilegible, bug de una acción) no puede tumbar el drenaje ni dejar sin subir al resto.
  it('un ítem que lanza una excepción se cuenta como fallo y no corta a los que siguen', async () => {
    mockCola.push(item(1, 'visit'), item(2, 'payment'));
    mockSendBehavior.throws = new Error('boom');
    const r = await drain('u1');
    expect(r.failed).toBe(2);
    expect(mockOps).toContain('markFailed:1:boom');
    expect(mockOps).toContain('send:payment'); // el segundo se intentó igual
    expect(mockOps.some((o) => o.startsWith('dequeue'))).toBe(false);
  });

  // Los ítems guardados antes de que existieran los ids reciben uno estable ANTES del primer envío.
  it('estabiliza (ids) cada ítem antes de enviarlo', async () => {
    mockCola.push(item(7, 'mora.activity'));
    await drain('u1');
    expect(mockOps.indexOf('stabilize:7')).toBeGreaterThanOrEqual(0);
    expect(mockOps.indexOf('stabilize:7')).toBeLessThan(mockOps.indexOf('send:mora.activity'));
  });

  // Una fila que esta versión no entiende se rechaza como «no soportada» y queda a la vista.
  it('una acción no soportada queda rechazada (a la vista), no borrada', async () => {
    mockCola.push(item(1, 'unsupported'));
    mockSend.result = { status: 'error', message: 'No soportado: x', permanent: true };
    await drain('u1');
    expect(mockOps).toContain('markRejected:1:No soportado: x');
    expect(mockOps.some((o) => o.startsWith('dequeue'))).toBe(false);
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

describe('queueForLater · altas offline visibles', () => {
  // Sin esto el cliente dado de alta en la puerta del deudor no aparecía en la búsqueda ni en la ficha hasta subir.
  it('escribe la fila provisional del cliente y del préstamo al encolarlos', async () => {
    expect(await queueForLater({ kind: 'client.create', input: { id: 'cli-1', clientType: 'PERSON', firstName: 'Ana' } })).toBe(true);
    expect(await queueForLater({ kind: 'credit.create', input: { id: 'cre-1', clientId: 'cli-1' } as never })).toBe(true);
    expect(mockOps).toEqual(['provisionalClient:cli-1', 'provisionalCredit:cre-1']);
  });
});
