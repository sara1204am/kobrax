import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import LoginPage from './page';

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Cuenta cuántas veces llegó un POST al BFF de login. */
function trackLogin(respond: () => Response = () => HttpResponse.json({ step: 'done' })) {
  const calls: unknown[] = [];
  server.use(
    http.post('*/api/auth/login', async ({ request }) => {
      calls.push(await request.json());
      return respond();
    }),
  );
  return calls;
}

describe('LoginPage: validación por campo', () => {
  it('campos vacíos: un mensaje bajo cada campo y no llama al servidor', async () => {
    const calls = trackLogin();
    render(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(screen.getByText('Ingresa tu correo electrónico')).toBeInTheDocument();
    expect(screen.getByText('Ingresa tu contraseña', { selector: 'span[role="alert"]' })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('correo sin arroba: solo marca el correo, no la contraseña', async () => {
    const calls = trackLogin();
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'managerkobrax.demo');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(screen.getByText(/El formato del correo no es válido/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('ejemplo@empresa.com')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByPlaceholderText('Ingresa tu contraseña')).toHaveAttribute('aria-invalid', 'false');
    expect(calls).toHaveLength(0);
  });

  it('con datos válidos llama al servidor y sigue al paso', async () => {
    const calls = trackLogin();
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), ' manager@kobrax.demo ');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(calls).toEqual([{ email: 'manager@kobrax.demo', password: 'Kobrax123!' }]);
  });

  it('un error del servidor va al aviso general, sin marcar campos', async () => {
    trackLogin(() =>
      HttpResponse.json({ error: { code: 'AUTH_001', message: 'Credenciales inválidas' } }, { status: 401 }),
    );
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
    expect(screen.getByPlaceholderText('ejemplo@empresa.com')).toHaveAttribute('aria-invalid', 'false');
  });

  it('el detalle por campo del servidor se pinta bajo el campo', async () => {
    trackLogin(() =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validación fallida',
            details: { fields: { email: ['El formato del correo no es válido'] }, messages: [] },
          },
        },
        { status: 400 },
      ),
    );
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(await screen.findByText('El formato del correo no es válido')).toBeInTheDocument();
    expect(screen.queryByText('Validación fallida')).not.toBeInTheDocument();
  });
});
