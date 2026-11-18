import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { SIGNUP_DOCS, acceptLegal, legalHandler, privacyBox, termsBox } from '@/test/legal';
import { hardNav } from '@/lib/client';
import InvitacionPage from './page';

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));

const { hardNavigate } = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
// El login termina con una carga completa (`window.location.replace`), no con el router.
beforeEach(() => {
  hardNavigate.mockClear();
  vi.spyOn(hardNav, 'replace').mockImplementation(hardNavigate);
});
afterEach(() => vi.restoreAllMocks());
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Marca las dos casillas (están debajo de la confirmación de contraseña) y pulsa «Entrar a Kobrax». */
async function entrar() {
  await acceptLegal();
  await userEvent.click(screen.getByRole('button', { name: /entrar a kobrax/i }));
}

const INVITATION = { email: 'ana@kobrax.demo', firstName: 'Ana', businessName: 'Cobranzas Pérez' };

describe('InvitacionPage', () => {
  beforeEach(() => {
    server.use(legalHandler());
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
    await entrar();

    // El código y la contraseña viajan tal cual; la aceptación viaja como ids de versión (nunca un texto ni un hash), y sin marcar
    // el marketing no viaja ningún consentimiento opcional.
    expect(sent).toEqual({
      code: 'abcd-1234',
      password: 'Kobrax123!',
      termsVersionId: SIGNUP_DOCS[0]!.versionId,
      privacyVersionId: SIGNUP_DOCS[1]!.versionId,
    });
    expect(loginBody).toEqual({ email: 'ana@kobrax.demo', password: 'Kobrax123!' });
    expect(hardNavigate).toHaveBeenCalledWith('/dashboard');
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
    await entrar();

    expect(await screen.findByRole('alert')).toHaveTextContent(/tu contraseña quedó guardada/i);
    expect(screen.queryByRole('button', { name: /entrar a kobrax/i })).toBeNull();
    expect(screen.getByRole('link', { name: /ir a iniciar sesión/i })).toBeInTheDocument();
  });
});

/** Privacidad: quien se une por invitación también acepta los Términos y reconoce la Política, con las casillas en línea. */
describe('InvitacionPage · aceptación legal en línea', () => {
  beforeEach(() => {
    server.use(legalHandler(), http.get('*/api/auth/invitacion/:code', () => HttpResponse.json(INVITATION)));
    window.history.replaceState({}, '', '/invitacion?c=ABCD1234');
  });

  async function fillPasswords() {
    await screen.findByText(/te uniste a/i);
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'Kobrax123!');
  }

  it('🔴 las dos casillas aparecen debajo de las contraseñas, desmarcadas, y no se puede entrar sin ellas', async () => {
    render(<InvitacionPage />);
    await fillPasswords();
    const terms = await termsBox();
    const privacy = await privacyBox();
    expect(terms).not.toBeChecked();
    expect(privacy).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    const entrar = screen.getByRole('button', { name: /entrar a kobrax/i });
    expect(entrar).toBeDisabled();
    await userEvent.click(terms);
    expect(entrar).toBeDisabled();
    await userEvent.click(privacy);
    expect(entrar).toBeEnabled();
  });

  it('🔴 si la versión cambió, avisa, desmarca y no se consume la invitación ni se encadena el login', async () => {
    let loginCalls = 0;
    server.use(
      http.post('*/api/auth/invitacion', () =>
        HttpResponse.json({ error: { code: 'LEGAL_VERSION_STALE', message: 'Los documentos legales cambiaron' } }, { status: 409 }),
      ),
      http.post('*/api/auth/login', () => {
        loginCalls += 1;
        return HttpResponse.json({ step: 'done' });
      }),
    );
    render(<InvitacionPage />);
    await fillPasswords();
    await entrar();

    expect(await screen.findByText(/se actualizaron mientras completabas/i)).toBeInTheDocument();
    expect(await termsBox()).not.toBeChecked();
    expect(screen.getByRole('button', { name: /entrar a kobrax/i })).toBeDisabled();
    expect(loginCalls).toBe(0);
  });
});
