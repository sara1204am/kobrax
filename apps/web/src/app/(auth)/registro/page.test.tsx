import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import RegistroPage from './page';

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

async function fillForm() {
  await userEvent.type(screen.getByLabelText('Nombre del negocio'), 'Cobranzas Pérez');
  await userEvent.type(screen.getByLabelText('Nombre'), 'Sara');
  await userEvent.type(screen.getByLabelText('Apellido'), 'Pérez');
  await userEvent.type(screen.getByLabelText('Correo electrónico'), '  Sara@Kobrax.Demo ');
  await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
}

/**
 * Lo que se prueba acá es la **secuencia**, no el formulario: el alta no devuelve tokens, así que
 * la pantalla encadena un login con los mismos datos. Los dos casos que importan son el feliz y el
 * que deja la cuenta creada a medio camino — ese segundo es el que, mal resuelto, manda a la
 * usuaria a reintentar un alta que ya existe y cobrarse un 409.
 */
describe('RegistroPage', () => {
  it('crea la cuenta, inicia sesión y confirma antes de seguir al paso siguiente', async () => {
    let alta: unknown;
    server.use(
      http.post('*/api/auth/registro', async ({ request }) => {
        alta = await request.json();
        return HttpResponse.json({ accountId: 'acc-1', email: 'sara@kobrax.demo' });
      }),
      http.post('*/api/auth/login', () => HttpResponse.json({ step: 'mfa_setup' })),
    );

    render(<RegistroPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));

    expect(await screen.findByText(/cuenta creada/i)).toBeInTheDocument();
    // Correo y nombre del negocio recortados y en minúscula: es lo que espera el `@IsEmail` y lo
    // que evita dos cuentas que sólo difieren en un espacio.
    expect(alta).toMatchObject({ businessName: 'Cobranzas Pérez', email: 'sara@kobrax.demo' });

    // No salta solo al enrolamiento de MFA: espera el clic.
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(push).toHaveBeenCalledWith('/login/mfa-setup');
  });

  it('si el alta sale bien pero el login falla, deja de ofrecer crear la cuenta', async () => {
    server.use(
      http.post('*/api/auth/registro', () => HttpResponse.json({ accountId: 'acc-1', email: 'sara@kobrax.demo' })),
      http.post('*/api/auth/login', () =>
        HttpResponse.json({ error: { code: 'AUTH_003', message: 'Cuenta bloqueada' } }, { status: 401 }),
      ),
    );

    render(<RegistroPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/tu cuenta se creó/i);
    expect(screen.queryByRole('button', { name: /crear cuenta/i })).toBeNull();
    expect(screen.getByRole('link', { name: /ir a iniciar sesión/i })).toBeInTheDocument();
  });

  it('propaga el error del backend y no encadena el login', async () => {
    let loginCalls = 0;
    server.use(
      http.post('*/api/auth/registro', () =>
        HttpResponse.json({ error: { code: 'ACC_001', message: 'Ese correo ya está registrado' } }, { status: 409 }),
      ),
      http.post('*/api/auth/login', () => {
        loginCalls += 1;
        return HttpResponse.json({ step: 'done' });
      }),
    );

    render(<RegistroPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya está registrado/i);
    expect(loginCalls).toBe(0);
    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeInTheDocument();
  });
});
