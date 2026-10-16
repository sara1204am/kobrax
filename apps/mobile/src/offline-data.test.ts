jest.mock('./db', () => ({ countKind: jest.fn(async () => 0), fetchedAt: jest.fn(async () => null) }));

import { stepDetail, whenDownloaded } from './offline-data';

describe('whenDownloaded', () => {
  const now = new Date(2026, 9, 13, 15, 0, 0); // 13 oct 2026, 15:00 locales
  it('nunca', () => expect(whenDownloaded(null, now)).toBe('Nunca'));
  it('hoy con la hora', () => expect(whenDownloaded(new Date(2026, 9, 13, 8, 5).getTime(), now)).toBe('hoy 08:05'));
  it('ayer con la hora', () => expect(whenDownloaded(new Date(2026, 9, 12, 21, 40).getTime(), now)).toBe('ayer 21:40'));
  it('días atrás', () => expect(whenDownloaded(new Date(2026, 9, 10, 9, 0).getTime(), now)).toBe('hace 3 días'));
});

describe('stepDetail', () => {
  it('bajando de a uno', () => expect(stepDetail({ name: 'x', state: 'running', done: 3, total: 10 })).toBe('3 de 10'));
  it('bajando sin conteo', () => expect(stepDetail({ name: 'x', state: 'running' })).toBe('Descargando…'));
  it('listo con conteo', () => expect(stepDetail({ name: 'x', state: 'ok', done: 10, total: 10 })).toBe('10 de 10'));
  it('listo sin conteo', () => expect(stepDetail({ name: 'x', state: 'ok' })).toBe('Listo'));
  it('sin señal', () => expect(stepDetail({ name: 'x', state: 'offline' })).toBe('Sin señal'));
  it('falló', () => expect(stepDetail({ name: 'x', state: 'error' })).toBe('No se pudo bajar'));
});
