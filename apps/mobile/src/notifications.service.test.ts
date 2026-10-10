const mockQuery = jest.fn();
const mockRows: { readAt: string | null }[] = [];
jest.mock('./api-client', () => ({
  apiQuery: (...a: unknown[]) => mockQuery(...a),
  apiMutate: jest.fn(),
  toQuery: (p: Record<string, unknown>) => '?' + Object.entries(p).map(([k, v]) => `${k}=${v}`).join('&'),
}));
jest.mock('./db', () => ({ getMany: jest.fn(async () => mockRows) }));
jest.mock('./sync/cached', () => ({ cachedList: jest.fn() }));

import { unreadCount, whenLabel } from './notifications.service';

describe('unreadCount', () => {
  it('con señal usa el total del servidor', async () => {
    mockQuery.mockResolvedValue({ status: 'ok', data: [], total: 7 });
    expect(await unreadCount()).toBe(7);
  });

  it('sin señal cuenta las no leídas del buzón guardado', async () => {
    mockQuery.mockResolvedValue({ status: 'offline' });
    mockRows.splice(0, mockRows.length, { readAt: null }, { readAt: '2026-10-09T10:00:00Z' }, { readAt: null });
    expect(await unreadCount()).toBe(2);
  });

  it('un error del servidor no inventa un número', async () => {
    mockQuery.mockResolvedValue({ status: 'error', message: 'x' });
    expect(await unreadCount()).toBe(0);
  });
});

describe('whenLabel', () => {
  it('de hoy muestra la hora, no la fecha', () => {
    const hoy = new Date(2026, 7, 6, 14, 32);
    expect(whenLabel(hoy.toISOString(), '2026-08-06')).toBe('14:32');
  });

  it('de otro día muestra la fecha', () => {
    const ayer = new Date(2026, 7, 5, 14, 32);
    expect(whenLabel(ayer.toISOString(), '2026-08-06')).toBe('Miércoles, 5 de agosto');
  });

  // Una notificación de las 23:50 locales cae en el día UTC siguiente: comparar contra un "hoy"
  // en UTC la mandaría a la rama de fecha estando el cobrador todavía en el mismo día.
  it('usa el día LOCAL, no el UTC', () => {
    const tarde = new Date(2026, 7, 6, 23, 50);
    expect(whenLabel(tarde.toISOString(), '2026-08-06')).toBe('23:50');
  });

  it('una fecha inválida no rompe la fila', () => {
    expect(whenLabel('no-es-fecha')).toBe('');
  });
});
