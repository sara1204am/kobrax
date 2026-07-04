import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeByStep, type AccountOption } from './client';

beforeEach(() => sessionStorage.clear());

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
