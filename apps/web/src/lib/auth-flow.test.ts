// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { LoginResult } from '@kobrax/shared';
import { stepResponse, apiError } from './auth-flow';

describe('stepResponse', () => {
  it('step done: setea cookies de tokens y limpia el pre-auth', async () => {
    const res = stepResponse({ step: 'done', accessToken: 'acc', refreshToken: 'ref' } as LoginResult);
    expect(await res.json()).toMatchObject({ step: 'done' });
    expect(res.cookies.get('k_access')?.value).toBe('acc');
    expect(res.cookies.get('k_refresh')?.value).toBe('ref');
  });

  it('paso intermedio: guarda el pre-auth en cookie y NUNCA expone tokens al navegador', async () => {
    const res = stepResponse({ step: 'mfa', preAuthToken: 'pre' } as LoginResult);
    const body = await res.json();
    expect(body.step).toBe('mfa');
    expect(res.cookies.get('k_preauth')?.value).toBe('pre');
    expect(res.cookies.get('k_access')).toBeUndefined();
  });

  it('select_account propaga la lista de cuentas', async () => {
    const accounts = [{ id: 'a1', name: 'DEMO', role: 'SUPERVISOR', status: 'ACTIVE' }];
    const res = stepResponse({ step: 'select_account', preAuthToken: 'pre', accounts } as LoginResult);
    expect((await res.json()).accounts).toEqual(accounts);
  });
});

describe('apiError', () => {
  it('propaga code/message del backend con su status', async () => {
    const res = apiError(400, {
      data: null,
      error: { code: 'AUTH_005', message: 'Token inválido' },
      meta: { timestamp: '', version: '1' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: 'AUTH_005', message: 'Token inválido' });
  });

  it('normaliza un status no-error a 400', () => {
    const res = apiError(200, { data: null, error: null, meta: { timestamp: '', version: '1' } });
    expect(res.status).toBe(400);
  });
});
