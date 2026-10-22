import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PLANS, type AccountInfo } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { BillingForm } from './billing-form';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const ACCOUNT: AccountInfo = {
  id: 'acc-1',
  businessName: 'Cobranzas Pérez',
  taxId: null,
  accountType: 'BUSINESS',
  status: 'ACTIVE',
  planCode: 'PROFESSIONAL',
  countryCode: 'BO',
  currencyCode: 'BOB',
  timezone: 'America/La_Paz',
  currencyDecimals: 2,
  limits: PLANS.PROFESSIONAL.limits,
  usage: { users: 3, credits: 120, clients: 90, photosPerMonth: 40, actionsPerMonth: 12 },
  billing: { legalName: 'Pérez SRL', taxId: '123456', address: null, email: 'facturas@perez.co' },
};

function renderIt(permissions = ['account:read', 'account:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <BillingForm account={ACCOUNT} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

function capture(sink: unknown[]) {
  return http.patch('*/api/account/me', async ({ request }) => {
    sink.push(await request.json());
    return HttpResponse.json(ACCOUNT);
  });
}

beforeEach(() => refresh.mockClear());

describe('BillingForm', () => {
  it('muestra lo guardado y deja guardar apagado mientras no se toque nada', () => {
    renderIt();
    expect(screen.getByLabelText(/Razón social/)).toHaveValue('Pérez SRL');
    expect(screen.getByRole('button', { name: 'Guardar datos' })).toBeDisabled();
  });

  it('manda sólo el campo tocado, dentro de «billing»', async () => {
    const enviados: unknown[] = [];
    server.use(capture(enviados));
    renderIt();
    await userEvent.type(screen.getByLabelText('Dirección fiscal'), 'Av. 6 de Agosto 1234');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));

    expect(enviados).toEqual([{ billing: { address: 'Av. 6 de Agosto 1234' } }]);
    expect(await screen.findByText('Datos de facturación guardados')).toBeInTheDocument();
  });

  it('vaciar un dato cargado lo QUITA con null', async () => {
    const enviados: unknown[] = [];
    server.use(capture(enviados));
    renderIt();
    await userEvent.clear(screen.getByLabelText(/Correo para facturas/));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));

    expect(enviados).toEqual([{ billing: { email: null } }]);
  });

  it('muestra el mensaje del servidor si rechaza', async () => {
    server.use(
      http.patch('*/api/account/me', () => HttpResponse.json({ error: { code: 'VALIDATION', message: 'Correo inválido' } }, { status: 400 })),
    );
    renderIt();
    await userEvent.type(screen.getByLabelText('Dirección fiscal'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo inválido');
  });

  it('sin permiso de escritura es de lectura', () => {
    renderIt(['account:read']);
    expect(screen.getByLabelText(/Razón social/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar datos' })).not.toBeInTheDocument();
  });
});
