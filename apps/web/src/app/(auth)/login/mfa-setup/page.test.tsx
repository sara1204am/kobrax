import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import MfaSetupPage from './page';

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));

/** Arranque: `start` entrega el secreto y `/auth/me` dice si ya hay sesión. */
function setup({ session = false, skip }: { session?: boolean; skip?: () => Response } = {}) {
  const actions: string[] = [];
  server.use(
    http.get('*/api/auth/me', () =>
      session ? HttpResponse.json({ userId: 'u1' }) : HttpResponse.json({ error: { code: 'AUTH_003' } }, { status: 401 }),
    ),
    http.post('*/api/auth/mfa/setup', async ({ request }) => {
      const { action } = (await request.json()) as { action: string };
      actions.push(action);
      if (action === 'start') return HttpResponse.json({ otpauthUrl: 'otpauth://totp/x', secret: 'ABCDEF' });
      if (action === 'skip' && skip) return skip();
      return HttpResponse.json({ step: 'done' });
    }),
  );
  return actions;
}

describe('MfaSetupPage · Lo hago después (W-LOG-51)', () => {
  it('muestra el enlace «Lo hago después» debajo de «Activar»', async () => {
    setup();
    render(<MfaSetupPage />);
    expect(await screen.findByRole('button', { name: 'Lo hago después' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument();
  });

  it('al tocarlo llama a la acción skip y sigue con routeByStep (dashboard)', async () => {
    const actions = setup({ skip: () => HttpResponse.json({ step: 'done' }) });
    render(<MfaSetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lo hago después' }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(actions).toContain('skip');
  });

  it('con varias empresas sigue al selector de empresa', async () => {
    const accounts = [{ id: 'a1', name: 'Demo', role: 'ACCOUNT_ADMIN', status: 'ACTIVE' }];
    setup({ skip: () => HttpResponse.json({ step: 'select_account', accounts }) });
    render(<MfaSetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lo hago después' }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/login/select-account'));
  });

  it('si el servidor rechaza, muestra el error y no navega', async () => {
    push.mockClear();
    replace.mockClear();
    setup({
      skip: () => HttpResponse.json({ error: { code: 'AUTH_003', message: 'Sesión de login expirada' } }, { status: 401 }),
    });
    render(<MfaSetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lo hago después' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sesión de login expirada');
    expect(replace).not.toHaveBeenCalled();
  });

  it('con una sesión ya abierta muestra «Volver» en vez de «Lo hago después»', async () => {
    setup({ session: true });
    render(<MfaSetupPage />);
    expect(await screen.findByRole('button', { name: 'Volver' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lo hago después' })).not.toBeInTheDocument();
  });
});
