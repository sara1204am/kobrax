import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import ResetPasswordPage from './page';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    replace.mockClear();
    window.history.replaceState({}, '', '/reset-password?token=tok123');
  });

  it('avisa cuando falta el token en el enlace', () => {
    window.history.replaceState({}, '', '/reset-password');
    render(<ResetPasswordPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/falta el token/i);
  });

  it('mantiene el botón deshabilitado si la política no se cumple o no coinciden', async () => {
    render(<ResetPasswordPage />);
    const btn = screen.getByRole('button', { name: /restablecer/i });
    expect(btn).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'Kobrax123!');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'distinta');
    expect(screen.getByText(/no coinciden/i)).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('restablece con una contraseña válida y confirma', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/auth/reset-password', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
    );
    render(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'Kobrax123!');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'Kobrax123!');

    const btn = screen.getByRole('button', { name: /restablecer/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);

    expect(await screen.findByText(/contraseña actualizada/i)).toBeInTheDocument();
    expect(body).toEqual({ token: 'tok123', newPassword: 'Kobrax123!' });
  });

  it('muestra el error del backend si el token es inválido', async () => {
    server.use(
      http.post('*/api/auth/reset-password', () =>
        HttpResponse.json({ error: { code: 'AUTH_005', message: 'Token inválido o expirado' } }, { status: 400 }),
      ),
    );
    render(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'Kobrax123!');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'Kobrax123!');
    await userEvent.click(screen.getByRole('button', { name: /restablecer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/token inválido/i);
  });
});
