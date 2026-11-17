import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { SIGNUP_DOCS, acceptLegal, legalHandler, privacyBox, termsBox } from '@/test/legal';
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

/**
 * Paso 1: elegir plan. La tarjeta entera es el botón, así que su nombre accesible incluye el
 * nombre del plan — que es justamente por lo que la persona la elige.
 */
async function pickPlan(plan: RegExp = /Free/) {
  await userEvent.click(screen.getByRole('button', { name: plan }));
}

async function fillForm() {
  await pickPlan();
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
  // Los documentos vigentes que la pantalla pide al cargar (el reset de MSW los quita entre tests).
  beforeEach(() => server.use(legalHandler()));

  it('el paso 1 (elegir plan) ofrece volver a iniciar sesión', () => {
    render(<RegistroPage />);
    expect(screen.getByRole('link', { name: 'Ya tengo cuenta' })).toHaveAttribute('href', '/login');
  });

  it('🔴 no hay formulario hasta elegir plan, y el elegido viaja en el alta', async () => {
    let alta: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/auth/registro', async ({ request }) => {
        alta = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ accountId: 'acc-1', email: 'sara@kobrax.demo' });
      }),
      http.post('*/api/auth/login', () => HttpResponse.json({ step: 'done' })),
    );

    render(<RegistroPage />);
    // El plan decide lo que la cuenta va a poder hacer: se pregunta antes, no al final.
    expect(screen.queryByLabelText('Nombre del negocio')).toBeNull();

    await pickPlan(/Professional/);
    await userEvent.type(screen.getByLabelText('Nombre del negocio'), 'Cobranzas Pérez');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Sara');
    await userEvent.type(screen.getByLabelText('Apellido'), 'Pérez');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'sara@kobrax.demo');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
    await crear();

    await screen.findByText(/cuenta creada/i);
    // El BFF arma el cuerpo campo por campo: lo que no nombre se pierde en silencio.
    expect(alta).toMatchObject({ planCode: 'PROFESSIONAL' });
    // Y se le dice qué pasa a los 30 días antes de que se entere el día que vence.
    expect(screen.getByText(/sigue funcionando en el plan Free/i)).toBeInTheDocument();
  });

  it('volver a cambiar el plan no borra lo que ya escribió', async () => {
    render(<RegistroPage />);
    await pickPlan(/Business/);
    await userEvent.type(screen.getByLabelText('Nombre del negocio'), 'Cobranzas Pérez');

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    await pickPlan(/Free/);

    expect(screen.getByLabelText('Nombre del negocio')).toHaveValue('Cobranzas Pérez');
    expect(screen.getByText('Plan Free')).toBeInTheDocument();
  });

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
    await crear();

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
    await crear();

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
    await crear();

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya está registrado/i);
    expect(loginCalls).toBe(0);
    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeInTheDocument();
  });
});

/**
 * Privacidad: no hay alta sin aceptar los Términos y reconocer la Política; lo opcional nunca la bloquea y nace desmarcado.
 * Lo que viaja son los **ids** de las versiones que se mostraron (el servidor calcula el hash con su copia).
 */
const TERMS_DOC = {
  id: 't-1',
  type: 'TERMS',
  locale: 'es',
  version: '1.0.0',
  title: 'Términos y Condiciones de Uso',
  content: 'Texto de los términos de prueba.',
  contentSha256: 'a'.repeat(64),
  isMaterial: true,
  changeSummary: null,
  publishedAt: '2026-11-16T12:00:00.000Z',
  effectiveAt: '2026-11-16T12:00:00.000Z',
};

/** Marca las dos casillas (están debajo de la contraseña) y pulsa «Crear cuenta». */
async function crear() {
  await acceptLegal();
  await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));
}

async function fillWithoutLegal() {
  await pickPlan();
  await userEvent.type(screen.getByLabelText('Nombre del negocio'), 'Cobranzas Pérez');
  await userEvent.type(screen.getByLabelText('Nombre'), 'Sara');
  await userEvent.type(screen.getByLabelText('Apellido'), 'Pérez');
  await userEvent.type(screen.getByLabelText('Correo electrónico'), 'sara@kobrax.demo');
  await userEvent.type(screen.getByLabelText('Contraseña'), 'Kobrax123!');
}

/**
 * Privacidad: las dos casillas obligatorias van EN LÍNEA, debajo de la contraseña y sin más texto (el formulario entra en pantalla).
 * Cada enlace abre UN solo modal con el documento (sin pop-up previo); al aceptar ahí se marca la casilla. Lo que viaja son los
 * **ids** de las versiones que se mostraron.
 */
describe('RegistroPage · aceptación legal en línea', () => {
  beforeEach(() => server.use(legalHandler()));

  const openDialogs = () => document.querySelectorAll('dialog[open]').length;

  it('🔴 las dos casillas están debajo de la contraseña, con el texto aprobado y desmarcadas; sin resumen ni marketing', async () => {
    render(<RegistroPage />);
    await fillWithoutLegal();
    const terms = await termsBox();
    const privacy = await privacyBox();
    expect(terms).not.toBeChecked();
    expect(privacy).not.toBeChecked();
    expect(terms).toHaveAccessibleName('He leído y acepto los Términos y Condiciones de Uso de Kobrax.');
    expect(privacy).toHaveAccessibleName('He leído la Política de Privacidad y conozco cómo Kobrax recopila, utiliza, almacena y protege mis datos personales.');
    // Debajo de la contraseña, no antes.
    const password = screen.getByLabelText('Contraseña');
    expect(password.compareDocumentPosition(terms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByText('Resumen de privacidad')).toBeNull();
    expect(screen.queryByText(/noticias, promociones/i)).toBeNull();
    expect(screen.queryByText('Antes de continuar')).toBeNull(); // sin pop-up
  });

  it('🔴 «Crear cuenta» no se habilita sin las DOS casillas (son actos separados)', async () => {
    render(<RegistroPage />);
    await fillWithoutLegal();
    const crear = screen.getByRole('button', { name: /crear cuenta/i });
    expect(crear).toBeDisabled();
    await userEvent.click(await termsBox());
    expect(crear).toBeDisabled(); // solo los Términos no alcanza
    await userEvent.click(await privacyBox());
    expect(crear).toBeEnabled();
  });

  it('🔴 viajan los ids de las versiones mostradas; nunca un texto ni un hash, ni consentimientos opcionales', async () => {
    let alta: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/auth/registro', async ({ request }) => {
        alta = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ accountId: 'acc-1', email: 'sara@kobrax.demo' });
      }),
      http.post('*/api/auth/login', () => HttpResponse.json({ step: 'done' })),
    );
    render(<RegistroPage />);
    await fillWithoutLegal();
    await crear();
    await screen.findByText(/cuenta creada/i);
    expect(alta).toMatchObject({ termsVersionId: SIGNUP_DOCS[0]!.versionId, privacyVersionId: SIGNUP_DOCS[1]!.versionId });
    expect(alta).not.toHaveProperty('marketingOptIn');
    expect(JSON.stringify(alta)).not.toContain('contentSha256');
  });

  it('cada documento tiene su enlace permanente real; el clic normal abre UN solo modal con la versión EXACTA', async () => {
    const requested: string[] = [];
    server.use(
      http.get('*/api/legal/documents/terms', ({ request }) => {
        requested.push(new URL(request.url).search);
        return HttpResponse.json(TERMS_DOC);
      }),
    );
    render(<RegistroPage />);
    await fillWithoutLegal();
    const link = await screen.findByRole('link', { name: 'Términos y Condiciones de Uso' });
    expect(link).toHaveAttribute('href', '/terminos');
    expect(screen.getByRole('link', { name: 'Política de Privacidad' })).toHaveAttribute('href', '/privacidad');

    await userEvent.click(link);
    expect(await screen.findByText('Texto de los términos de prueba.')).toBeInTheDocument();
    expect(requested).toEqual(['?version=1.0.0']);
    // Un solo modal encima del formulario: nunca un modal sobre otro.
    expect(openDialogs()).toBe(1);
    // Lo escrito sigue intacto y abrir el documento NO marca la casilla: aceptar es un acto aparte.
    expect(screen.getByLabelText('Nombre del negocio')).toHaveValue('Cobranzas Pérez');
    expect(await termsBox()).not.toBeChecked();
  });

  it('🔴 «He leído y acepto» dentro del documento marca la casilla de los Términos, cierra el modal y vuelve al formulario', async () => {
    server.use(http.get('*/api/legal/documents/terms', () => HttpResponse.json(TERMS_DOC)));
    render(<RegistroPage />);
    await fillWithoutLegal();
    await userEvent.click(await screen.findByRole('link', { name: 'Términos y Condiciones de Uso' }));
    await screen.findByText('Texto de los términos de prueba.');
    await userEvent.click(screen.getByRole('button', { name: 'He leído y acepto' }));
    expect(await termsBox()).toBeChecked();
    expect(await privacyBox()).not.toBeChecked(); // la Privacidad sigue sin marcar
    expect(openDialogs()).toBe(0);
    expect(screen.getByLabelText('Nombre del negocio')).toHaveValue('Cobranzas Pérez');
  });

  it('el documento de la Política dice «He leído y conozco la política» y marca solo su casilla', async () => {
    server.use(http.get('*/api/legal/documents/privacy', () => HttpResponse.json({ ...TERMS_DOC, title: 'Política de Privacidad', content: 'Texto de la política.' })));
    render(<RegistroPage />);
    await fillWithoutLegal();
    await userEvent.click(await screen.findByRole('link', { name: 'Política de Privacidad' }));
    await screen.findByText('Texto de la política.');
    await userEvent.click(screen.getByRole('button', { name: 'He leído y conozco la política' }));
    expect(await privacyBox()).toBeChecked();
    expect(await termsBox()).not.toBeChecked();
  });

  it('cerrar el documento sin aceptar no marca nada', async () => {
    server.use(http.get('*/api/legal/documents/terms', () => HttpResponse.json(TERMS_DOC)));
    render(<RegistroPage />);
    await fillWithoutLegal();
    await userEvent.click(await screen.findByRole('link', { name: 'Términos y Condiciones de Uso' }));
    await screen.findByText('Texto de los términos de prueba.');
    // Hay dos «Cerrar» (la X del encabezado y el botón del pie): se usa el del pie.
    await userEvent.click(screen.getAllByRole('button', { name: 'Cerrar' }).at(-1)!);
    expect(await termsBox()).not.toBeChecked();
    expect(openDialogs()).toBe(0);
  });

  it('si el documento no se puede cargar, el modal lo dice y NO permite aceptar', async () => {
    server.use(http.get('*/api/legal/documents/terms', () => HttpResponse.json({ error: { code: 'X' } }, { status: 404 })));
    render(<RegistroPage />);
    await fillWithoutLegal();
    await userEvent.click(await screen.findByRole('link', { name: 'Términos y Condiciones de Uso' }));
    expect(await screen.findByText(/no se pudo cargar el documento/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'He leído y acepto' })).toBeDisabled();
  });

  it('con Ctrl apretado el enlace no abre el modal (deja que el navegador abra la página permanente)', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/legal/documents/terms', () => {
        calls += 1;
        return HttpResponse.json(TERMS_DOC);
      }),
    );
    render(<RegistroPage />);
    await fillWithoutLegal();
    const link = await screen.findByRole('link', { name: 'Términos y Condiciones de Uso' });
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(link);
    await user.keyboard('{/Control}');
    expect(calls).toBe(0);
    expect(openDialogs()).toBe(0);
  });

  it('si los documentos no cargan, lo dice, ofrece reintentar y no deja crear la cuenta', async () => {
    server.use(http.get('*/api/legal/signup-documents', () => HttpResponse.json({ error: { code: 'X' } }, { status: 404 })));
    render(<RegistroPage />);
    await fillWithoutLegal();
    expect(await screen.findByText(/no se pudieron cargar los términos/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeDisabled();

    server.use(legalHandler());
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await termsBox()).toBeInTheDocument();
  });

  it('🔴 si la versión cambió mientras llenaba el formulario: avisa, desmarca las casillas y no encadena el login', async () => {
    let loginCalls = 0;
    server.use(
      http.post('*/api/auth/registro', () =>
        HttpResponse.json({ error: { code: 'LEGAL_VERSION_STALE', message: 'Los documentos legales cambiaron' } }, { status: 409 }),
      ),
      http.post('*/api/auth/login', () => {
        loginCalls += 1;
        return HttpResponse.json({ step: 'done' });
      }),
    );
    render(<RegistroPage />);
    await fillWithoutLegal();
    await crear();

    expect(await screen.findByText(/se actualizaron mientras completabas/i)).toBeInTheDocument();
    expect(await termsBox()).not.toBeChecked();
    expect(await privacyBox()).not.toBeChecked();
    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeDisabled();
    expect(loginCalls).toBe(0);
  });
});
