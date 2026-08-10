import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import InvitacionPage from './page';

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const INVITATION = { email: 'ana@kobrax.demo', firstName: 'Ana', businessName: 'Cobranzas Pérez' };

describe('InvitacionPage', () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    window.history.replaceState({}, '', '/invitacion');
  });

  it('con el código en el link busca la invitación sola y la pinta', async () => {
    server.use(http.get('*/api/auth/invitacion/:code', () => HttpResponse.json(INVITATION)));
    window.history.replaceState({}, '', '/invitacion?c=ABCD1234');

    render(<InvitacionPage />);
    expect(await screen.findByText(/te uniste a cobranzas pérez/i)).toBeInTheDocument();
    expect(screen.getByText(/ana@kobrax.demo/i)).toBeInTheDocument();
  });

  /**
   * El código sale del link tal cual: normalizarlo (mayúsculas, guiones) es del servidor, que es
   * quien conoce el formato del token. Si la web lo tocara, un código válido dejaría de andar.
   */
  it('manda el código sin tocarlo y encadena el login con el correo de la invitación', async () => {
    let sent: unknown;
    let loginBody: unknown;
    server.use(
      http.get('*/api/auth/invitacion/:code', () => HttpResponse.json(INVITATION)),
      http.post('*/api/auth/invitacion', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ email: INVITATION.email });
      }),
      http.post('*/api/auth/login', async ({ request }) => {
        loginBody = await request.json();
        return HttpResponse.json({ step: 'done' });
      }),
    );
    window.history.replaceState({}, '', '/invitacion?c=abcd-1234');

    render(<InvitacionPage />);
    await screen.findByText(/te uniste a/i);
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'Kobrax123!');
    await userEvent.click(screen.getByRole('button', { name: /entrar a kobrax/i }));

    expect(sent).toEqual({ code: 'abcd-1234', password: 'Kobrax123!' });
    expect(loginBody).toEqual({ email: 'ana@kobrax.demo', password: 'Kobrax123!' });
    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('un código que no existe se queda en el paso del código con el error del backend', async () => {
    server.use(
      http.get('*/api/auth/invitacion/:code', () =>
        HttpResponse.json({ error: { code: 'AUTH_006', message: 'Invitación inválida' } }, { status: 400 }),
      ),
    );

    render(<InvitacionPage />);
    await userEvent.type(screen.getByLabelText('Código de invitación'), 'NOEXISTE1');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invitación inválida/i);
    expect(screen.getByLabelText('Código de invitación')).toBeInTheDocument();
  });

  /** El código es de un solo uso: si el login posterior falla, reintentar lo quemaría de nuevo. */
  it('aceptada la invitación, un login fallido no deja reintentar', async () => {
    server.use(
      http.get('*/api/auth/invitacion/:code', () => HttpResponse.json(INVITATION)),
      http.post('*/api/auth/invitacion', () => HttpResponse.json({ email: INVITATION.email })),
      http.post('*/api/auth/login', () =>
        HttpResponse.json({ error: { code: 'AUTH_001', message: 'Credenciales inválidas' } }, { status: 401 }),
      ),
    );
    window.history.replaceState({}, '', '/invitacion?c=ABCD1234');

    render(<InvitacionPage />);
    await screen.findByText(/te uniste a/i);
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'Kobrax123!');
    await userEvent.click(screen.getByRole('button', { name: /entrar a kobrax/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/tu contraseña quedó guardada/i);
    expect(screen.queryByRole('button', { name: /entrar a kobrax/i })).toBeNull();
    expect(screen.getByRole('link', { name: /ir a iniciar sesión/i })).toBeInTheDocument();
  });
});
