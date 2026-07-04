import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import ForgotPasswordPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('ForgotPasswordPage', () => {
  it('envía el correo y muestra la confirmación genérica (anti-enumeration)', async () => {
    let received: unknown;
    server.use(
      http.post('*/api/auth/forgot-password', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
    );
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText('Correo'), 'ana@kobrax.demo');
    await userEvent.click(screen.getByRole('button', { name: /enviar enlace/i }));

    expect(await screen.findByText(/revisa tu correo/i)).toBeInTheDocument();
    expect(received).toEqual({ email: 'ana@kobrax.demo' });
  });

  it('muestra el mensaje de error del backend (p.ej. rate-limit)', async () => {
    server.use(
      http.post('*/api/auth/forgot-password', () =>
        HttpResponse.json({ error: { code: 'RATE_LIMITED', message: 'Demasiados intentos' } }, { status: 429 }),
      ),
    );
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText('Correo'), 'ana@kobrax.demo');
    await userEvent.click(screen.getByRole('button', { name: /enviar enlace/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/demasiados intentos/i);
  });
});
