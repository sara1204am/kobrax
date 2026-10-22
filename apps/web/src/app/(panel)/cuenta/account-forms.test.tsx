import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PLANS, type AccountInfo } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { FinancialForm } from './financial-form';
import { GeneralForm } from './general-form';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const ACCOUNT: AccountInfo = {
  id: 'acc-1',
  businessName: 'Cobranzas Pérez',
  taxId: '123456',
  accountType: 'BUSINESS',
  status: 'ACTIVE',
  planCode: 'PROFESSIONAL',
  countryCode: 'BO',
  currencyCode: 'BOB',
  timezone: 'America/La_Paz',
  currencyDecimals: 2,
  limits: PLANS.PROFESSIONAL.limits,
  usage: { users: 3, credits: 120, clients: 90, photosPerMonth: 40, actionsPerMonth: 12 },
};

function renderForm(
  permissions = ['account:read', 'account:write'],
  which: 'general' | 'financial' = 'general',
) {
  const Form = which === 'general' ? GeneralForm : FinancialForm;
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <Form account={ACCOUNT} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => refresh.mockClear());

describe('Cuenta · formularios — sólo se manda lo que cambió', () => {
  it('sin tocar nada, guardar está apagado', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('manda el campo tocado y NADA más', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ...ACCOUNT, businessName: 'Cobranzas Sara' });
      }),
    );

    renderForm();
    const nombre = screen.getByLabelText('Nombre del negocio');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Cobranzas Sara');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    // Reenviar el objeto del GET (con planCode, limits, usage…) sería un 400.
    expect(enviado).toEqual({ businessName: 'Cobranzas Sara' });
    // El nombre también vive en el selector de empresa de la topbar, que lo pintó el servidor.
    expect(refresh).toHaveBeenCalled();
  });

  it('borrar el NIT lo QUITA: manda null, no cadena vacía', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ...ACCOUNT, taxId: null });
      }),
    );

    renderForm();
    await userEvent.clear(screen.getByLabelText('NIT'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    // Con `''` el `@IsOptional() @Length(1,40)` de la API devolvía 400 y se perdía el
    // guardado entero: no había forma de quitar un NIT mal cargado.
    expect(enviado).toEqual({ taxId: null });
  });

  it('cambiar el país arrastra la moneda: no se pueden combinar mal', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(ACCOUNT);
      }),
    );

    renderForm(undefined, 'financial');
    await userEvent.selectOptions(screen.getByLabelText('País y moneda'), 'MX');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviado).toEqual({ countryCode: 'MX', currencyCode: 'MXN' });
  });

  it('elegir otra zona horaria manda sólo timezone', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ...ACCOUNT, timezone: 'America/Bogota' });
      }),
    );

    renderForm();
    await userEvent.selectOptions(screen.getByLabelText(/Zona horaria/), 'America/Bogota');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviado).toEqual({ timezone: 'America/Bogota' });
  });

  it('volver a «según el país» la QUITA: manda null y el server cae al huso del país', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ...ACCOUNT, timezone: null });
      }),
    );

    renderForm();
    await userEvent.selectOptions(screen.getByLabelText(/Zona horaria/), '');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviado).toEqual({ timezone: null });
  });

  it('cambiar los decimales manda sólo currencyDecimals, como string del select', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ...ACCOUNT, currencyDecimals: 0 });
      }),
    );

    renderForm(undefined, 'financial');
    await userEvent.selectOptions(screen.getByLabelText(/Decimales de los montos/), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviado).toEqual({ currencyDecimals: '0' });
  });

  it('el botón «usar la de este equipo» pone la zona del navegador, aunque no sea de América', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Usar la de este equipo' }));

    const select = screen.getByLabelText(/Zona horaria/) as HTMLSelectElement;
    // La detectada se agrega a las opciones si hace falta: sin eso, un huso fuera de América
    // (o el UTC de un entorno de CI) dejaría el select mudo.
    expect(select.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('después de guardar, volver a guardar queda apagado', async () => {
    server.use(http.patch('*/api/account/me', () => HttpResponse.json(ACCOUNT)));

    renderForm();
    await userEvent.type(screen.getByLabelText('NIT'), '789');
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    await userEvent.click(guardar);

    expect(await screen.findByText('Datos guardados')).toBeInTheDocument();
    expect(guardar).toBeDisabled();
  });

  it('muestra el error del backend y no dice que guardó', async () => {
    server.use(
      http.patch('*/api/account/me', () =>
        HttpResponse.json({ error: { code: 'VALIDATION', message: 'NIT inválido' } }, { status: 400 }),
      ),
    );

    renderForm();
    await userEvent.type(screen.getByLabelText('NIT'), '789');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('NIT inválido');
    expect(screen.queryByText('Datos guardados')).not.toBeInTheDocument();
  });
});

describe('Cuenta · identidad y contacto', () => {
  it('editar un dato de contacto manda sólo ese campo', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(ACCOUNT);
      }),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText('Ciudad'), 'Sucre');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(enviado).toEqual({ city: 'Sucre' });
  });

  it('vaciar un dato que estaba cargado lo QUITA: manda null, no cadena vacía', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(ACCOUNT);
      }),
    );
    render(
      <PermissionsProvider permissions={['account:read', 'account:write']}>
        <ToastProvider>
          <GeneralForm account={{ ...ACCOUNT, phone: '70000000' }} />
        </ToastProvider>
      </PermissionsProvider>,
    );
    await userEvent.clear(screen.getByLabelText(/Teléfono del negocio/));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(enviado).toEqual({ phone: null });
  });

  it('subir un logo lo deja en el formulario y «Quitar» lo vacía; recién al guardar se manda', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/account/upload', () => HttpResponse.json({ url: '/api/uploads/' + 'a'.repeat(64) + '.png' })),
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(ACCOUNT);
      }),
    );
    renderForm();
    const archivo = new File(['x'], 'logo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Logo del negocio'), archivo);

    expect(await screen.findByRole('button', { name: 'Quitar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(enviado).toEqual({ logoUrl: '/api/uploads/' + 'a'.repeat(64) + '.png' });
  });

  it('si la subida falla, lo dice con el mensaje del servidor y no cambia el logo', async () => {
    server.use(
      http.post('*/api/account/upload', () =>
        HttpResponse.json({ error: { code: 'X', message: 'Tipo no permitido' } }, { status: 400 }),
      ),
    );
    renderForm();
    await userEvent.upload(screen.getByLabelText('Logo del negocio'), new File(['x'], 'logo.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tipo no permitido');
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  });

  it('sin permiso de escritura no hay subida ni se puede quitar', () => {
    renderForm(['account:read']);
    expect(screen.queryByLabelText('Logo del negocio')).not.toBeInTheDocument();
    // El control no desaparece en silencio: el campo dice por qué no se puede subir.
    expect(screen.getByText('Solo un administrador puede cambiar el logo.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Teléfono del negocio/)).toBeDisabled();
  });
});

describe('Cuenta · formularios — sin permiso de escritura', () => {
  it('se ven los datos pero no hay con qué guardarlos', () => {
    renderForm(['account:read']);
    expect(screen.getByLabelText('Nombre del negocio')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });
});
