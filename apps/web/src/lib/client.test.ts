import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeByStep, sendJson, type AccountOption } from './client';

beforeEach(() => sessionStorage.clear());

describe('sendJson', () => {
  it('🔴 manda los headers que se le pidan además del content-type', async () => {
    // Por acá viaja `Idempotency-Key`, que `POST /payments` lee del header y no del cuerpo: sin
    // esto un doble clic registra el pago dos veces sobre un ledger que no se puede corregir.
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendJson('/api/payments', { amount: 100 }, 'POST', { 'idempotency-key': 'k-1' });

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'content-type': 'application/json',
      'idempotency-key': 'k-1',
    });
    vi.unstubAllGlobals();
  });
});

describe('routeByStep', () => {
  it('done → replace a /dashboard', () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    routeByStep(router, 'done');
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('mfa → push a /login/mfa', () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    routeByStep(router, 'mfa');
    expect(router.push).toHaveBeenCalledWith('/login/mfa');
  });

  it('mfa_setup → push a /login/mfa-setup', () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    routeByStep(router, 'mfa_setup');
    expect(router.push).toHaveBeenCalledWith('/login/mfa-setup');
  });

  it('select_account guarda las cuentas en sessionStorage y navega al selector', () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    const accounts: AccountOption[] = [{ id: 'a1', name: 'DEMO', role: 'SUPERVISOR', status: 'ACTIVE' }];
    routeByStep(router, 'select_account', accounts);
    expect(JSON.parse(sessionStorage.getItem('k_accounts')!)).toEqual(accounts);
    expect(router.push).toHaveBeenCalledWith('/login/select-account');
  });
});
