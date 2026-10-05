import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { sendJson } from './client';
import {
  getLoadedSessionId,
  judgeSession,
  publishSessionEvent,
  SESSION_STALE_EVENT,
  sessionIdFromToken,
  setLoadedSessionId,
  subscribeSessionEvents,
} from './session-sync';

const fakeJwt = (payload: object) => `h.${btoa(JSON.stringify(payload))}.s`;

describe('judgeSession', () => {
  const loaded = { userId: 'u1', accountId: 'a1', sessionId: 's1' };
  it('misma sesión', () => {
    expect(judgeSession(loaded, { userId: 'u1', accountId: 'a1', sessionId: 's1' })).toBe('same');
  });
  it('otra empresa, otro usuario u otra sesión = changed', () => {
    expect(judgeSession(loaded, { userId: 'u1', accountId: 'a2', sessionId: 's2' })).toBe('changed');
    expect(judgeSession(loaded, { userId: 'u2', accountId: 'a1', sessionId: 's1' })).toBe('changed');
    expect(judgeSession(loaded, { userId: 'u1', accountId: 'a1', sessionId: 's2' })).toBe('changed');
  });
  it('sin sesión en el servidor = ended', () => {
    expect(judgeSession(loaded, null)).toBe('ended');
  });
  it('API vieja sin sessionId: solo compara usuario y empresa', () => {
    expect(judgeSession(loaded, { userId: 'u1', accountId: 'a1' })).toBe('same');
  });
});

describe('sessionIdFromToken', () => {
  it('lee el sessionId del payload', () => {
    expect(sessionIdFromToken(fakeJwt({ sessionId: 'abc' }))).toBe('abc');
  });
  it('un token roto devuelve null', () => {
    expect(sessionIdFromToken('basura')).toBeNull();
    expect(sessionIdFromToken(fakeJwt({}))).toBeNull();
  });
});

describe('eventos entre pestañas', () => {
  afterEach(() => localStorage.clear());

  it('el evento storage (respaldo) llega a los suscriptores', () => {
    const handler = vi.fn();
    const off = subscribeSessionEvents(handler);
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'k_auth_event', newValue: JSON.stringify({ type: 'logout', at: 1 }) }),
    );
    expect(handler).toHaveBeenCalledWith({ type: 'logout', at: 1 });
    off();
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'k_auth_event', newValue: JSON.stringify({ type: 'login', at: 2 }) }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignora claves ajenas y valores rotos', () => {
    const handler = vi.fn();
    const off = subscribeSessionEvents(handler);
    window.dispatchEvent(new StorageEvent('storage', { key: 'otra', newValue: '{"type":"logout"}' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'k_auth_event', newValue: 'no-json' }));
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('publicar escribe el respaldo en localStorage', () => {
    publishSessionEvent('switch');
    expect(JSON.parse(localStorage.getItem('k_auth_event') ?? '{}').type).toBe('switch');
  });
});

describe('sendJson · control de sesión', () => {
  afterEach(() => setLoadedSessionId(null));

  it('manda x-k-session con la sesión de la pestaña', async () => {
    let header: string | null = null;
    server.use(
      http.post('*/api/x', ({ request }) => {
        header = request.headers.get('x-k-session');
        return HttpResponse.json({ ok: true });
      }),
    );
    setLoadedSessionId('sess-1');
    expect(getLoadedSessionId()).toBe('sess-1');
    await sendJson('/api/x', {});
    expect(header).toBe('sess-1');
  });

  it('sin sesión cargada (pantallas de login) no manda el header', async () => {
    let header: string | null = 'x';
    server.use(
      http.post('*/api/x', ({ request }) => {
        header = request.headers.get('x-k-session');
        return HttpResponse.json({});
      }),
    );
    await sendJson('/api/x', {});
    expect(header).toBeNull();
  });

  it('un 409 SESSION_CHANGED dispara el aviso de la pestaña', async () => {
    server.use(
      http.post('*/api/x', () =>
        HttpResponse.json({ error: { code: 'SESSION_CHANGED', message: 'Tu sesión cambió' } }, { status: 409 }),
      ),
    );
    const listener = vi.fn();
    window.addEventListener(SESSION_STALE_EVENT, listener);
    const res = await sendJson('/api/x', {});
    window.removeEventListener(SESSION_STALE_EVENT, listener);
    expect(res.ok).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('otro 409 (negocio) no dispara el aviso', async () => {
    server.use(http.post('*/api/x', () => HttpResponse.json({ error: { code: 'DUP', message: 'x' } }, { status: 409 })));
    const listener = vi.fn();
    window.addEventListener(SESSION_STALE_EVENT, listener);
    await sendJson('/api/x', {});
    window.removeEventListener(SESSION_STALE_EVENT, listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
