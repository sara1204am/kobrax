import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PLANS, type AccountInfo, type ArrearCategory } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { ArrearCategories } from './arrear-categories';
import { FinancialForm } from './financial-form';
import { GeneralForm } from './general-form';
import { SaveBarProvider } from './save-bar';

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

const CATS: ArrearCategory[] = [
  { id: '1', code: 'A', name: 'Categoría A', fromDays: 1, toDays: 30, color: null, sortOrder: 1 },
  { id: '2', code: 'B', name: 'Categoría B', fromDays: 31, toDays: null, color: null, sortOrder: 2 },
];

function renderCobranza() {
  return render(
    <PermissionsProvider permissions={['account:read', 'account:write', 'collection:read']}>
      <ToastProvider>
        <SaveBarProvider>
          <FinancialForm account={ACCOUNT} />
          <ArrearCategories categories={CATS} />
        </SaveBarProvider>
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => refresh.mockClear());

describe('barra de guardado única', () => {
  it('sin cambios no aparece, y los formularios no dibujan su propio botón', () => {
    renderCobranza();
    expect(screen.queryByRole('region', { name: 'Cambios sin guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar categorías' })).not.toBeInTheDocument();
  });

  it('editar dos secciones y guardar una vez manda un pedido por sección, cada uno con lo suyo', async () => {
    let cuenta: unknown;
    let categorias: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        cuenta = await request.json();
        return HttpResponse.json(ACCOUNT);
      }),
      http.put('*/api/arrear-categories', async ({ request }) => {
        categorias = await request.json();
        return HttpResponse.json({ data: CATS });
      }),
    );

    renderCobranza();
    await userEvent.selectOptions(screen.getByLabelText(/Decimales de los montos/), '0');
    await userEvent.clear(screen.getByLabelText('Nombre 1'));
    await userEvent.type(screen.getByLabelText('Nombre 1'), 'Leve');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Datos guardados')).toBeInTheDocument();
    expect(cuenta).toEqual({ currencyDecimals: '0' });
    expect(categorias).toBeDefined();
    // Todo guardado: la barra se va.
    expect(screen.queryByRole('region', { name: 'Cambios sin guardar' })).not.toBeInTheDocument();
  });

  it('si una sección falla, la otra queda guardada y la barra sigue con la que falló', async () => {
    server.use(
      http.patch('*/api/account/me', () => HttpResponse.json(ACCOUNT)),
      http.put('*/api/arrear-categories', () =>
        HttpResponse.json({ error: { code: 'VALIDATION', message: 'Rango inválido' } }, { status: 400 }),
      ),
    );

    renderCobranza();
    await userEvent.selectOptions(screen.getByLabelText(/Decimales de los montos/), '0');
    await userEvent.clear(screen.getByLabelText('Nombre 1'));
    await userEvent.type(screen.getByLabelText('Nombre 1'), 'Leve');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    // El error aparece en la sección que falló, no en la barra.
    expect(await screen.findByRole('alert')).toHaveTextContent('Rango inválido');
    // Sigue habiendo algo sin guardar (las categorías).
    expect(screen.getByRole('region', { name: 'Cambios sin guardar' })).toBeInTheDocument();
  });

  it('descartar devuelve los valores y esconde la barra, sin pedir nada al servidor', async () => {
    let pedidos = 0;
    server.use(
      http.patch('*/api/account/me', () => {
        pedidos += 1;
        return HttpResponse.json(ACCOUNT);
      }),
    );

    renderCobranza();
    const decimales = screen.getByLabelText(/Decimales de los montos/) as HTMLSelectElement;
    await userEvent.selectOptions(decimales, '0');
    expect(screen.getByRole('region', { name: 'Cambios sin guardar' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(decimales.value).toBe('2');
    expect(screen.queryByRole('region', { name: 'Cambios sin guardar' })).not.toBeInTheDocument();
    expect(pedidos).toBe(0);
  });

  it('una sección con errores de validación apaga Guardar y lo dice', async () => {
    renderCobranza();
    const desde = screen.getByLabelText('Desde (días) 2');
    await userEvent.clear(desde);
    await userEvent.type(desde, '45');

    expect(screen.getByText('Corrige los errores marcados para poder guardar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('el formulario General también se registra', async () => {
    render(
      <PermissionsProvider permissions={['account:read', 'account:write']}>
        <ToastProvider>
          <SaveBarProvider>
            <GeneralForm account={ACCOUNT} />
          </SaveBarProvider>
        </ToastProvider>
      </PermissionsProvider>,
    );
    await userEvent.type(screen.getByLabelText('NIT'), '9');
    expect(screen.getByRole('region', { name: 'Cambios sin guardar' })).toBeInTheDocument();
  });
});
