import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { SessionWatcher } from './session-watcher';
import { SESSION_STALE_EVENT } from '@/lib/session-sync';

const SESSION = { userId: 'u1', accountId: 'a1', sessionId: 's1' };

const original = window.location;
function stubLocation() {
  const reload = vi.fn();
  const replace = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload, replace } });
  return { reload, replace };
}
function storageEvent(type: string) {
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'k_auth_event', newValue: JSON.stringify({ type, at: Date.now() }) }),
  );
}
const meReturns = (data: object | null, status = 200) =>
  server.use(
    http.get('*/api/auth/me', () => (data ? HttpResponse.json(data, { status }) : new HttpResponse(null, { status }))),
  );

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: original });
  sessionStorage.clear();
});

describe('SessionWatcher (W-LOG-54)', () => {
  it('logout en otra pestaña: va a /login sin esperar un clic', () => {
    const loc = stubLocation();
    render(<SessionWatcher session={SESSION} />);
    act(() => storageEvent('logout'));
    expect(loc.replace).toHaveBeenCalledWith('/login');
  });

  it('login de otro usuario en otra pestaña: recarga y deja el aviso para después', async () => {
    const loc = stubLocation();
    meReturns({ userId: 'u2', accountId: 'a1', sessionId: 's2' });
    render(<SessionWatcher session={SESSION} />);
    act(() => storageEvent('login'));
    await vi.waitFor(() => expect(loc.reload).toHaveBeenCalled());
    expect(sessionStorage.getItem('k_session_notice')).toBe('1');
  });

  it('cambio de empresa en otra pestaña: recarga', async () => {
    const loc = stubLocation();
    meReturns({ userId: 'u1', accountId: 'a2', sessionId: 's2' });
    render(<SessionWatcher session={SESSION} />);
    act(() => storageEvent('switch'));
    await vi.waitFor(() => expect(loc.reload).toHaveBeenCalled());
  });

  it('si la sesión sigue siendo la misma no recarga', async () => {
    const loc = stubLocation();
    meReturns({ userId: 'u1', accountId: 'a1', sessionId: 's1' });
    render(<SessionWatcher session={SESSION} />);
    act(() => storageEvent('login'));
    await new Promise((r) => setTimeout(r, 50));
    expect(loc.reload).not.toHaveBeenCalled();
  });

  it('al recuperar el foco, un 401 manda a /login', async () => {
    const loc = stubLocation();
    meReturns(null, 401);
    render(<SessionWatcher session={SESSION} />);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await vi.waitFor(() => expect(loc.replace).toHaveBeenCalledWith('/login'));
  });

  it('tras la recarga muestra el aviso de que la sesión cambió', () => {
    sessionStorage.setItem('k_session_notice', '1');
    render(<SessionWatcher session={SESSION} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Tu sesión cambió en otra pestaña. Recargamos la página.');
    expect(sessionStorage.getItem('k_session_notice')).toBeNull();
  });

  it('un 409 del servidor muestra «Recarga la página para continuar»', () => {
    render(<SessionWatcher session={SESSION} />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(SESSION_STALE_EVENT));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Recarga la página para continuar');
  });
});
