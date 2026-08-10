import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AccountInfo } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { BusinessForm } from './business-form';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const ACCOUNT: AccountInfo = {
  id: 'acc-1',
  businessName: 'Cobranzas Pérez',
  taxId: '123456',
  accountType: 'BUSINESS',
  status: 'ACTIVE',
  planCode: 'PRO',
  countryCode: 'BO',
  currencyCode: 'BOB',
  timezone: 'America/La_Paz',
  maxUsers: 5,
  memberCount: 3,
};

function renderForm(permissions = ['account:read', 'account:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <BusinessForm account={ACCOUNT} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => refresh.mockClear());

describe('BusinessForm — sólo se manda lo que cambió', () => {
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

    // Reenviar el objeto del GET (con planCode, maxUsers, memberCount…) sería un 400.
    expect(enviado).toEqual({ businessName: 'Cobranzas Sara' });
    // El nombre también vive en el selector de empresa de la topbar, que lo pintó el servidor.
    expect(refresh).toHaveBeenCalled();
  });

  it('cambiar el país arrastra la moneda: no se pueden combinar mal', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/account/me', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(ACCOUNT);
      }),
    );

    renderForm();
    await userEvent.selectOptions(screen.getByLabelText('País y moneda'), 'MX');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviado).toEqual({ countryCode: 'MX', currencyCode: 'MXN' });
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

describe('BusinessForm — sin permiso de escritura', () => {
  it('se ven los datos pero no hay con qué guardarlos', () => {
    renderForm(['account:read']);
    expect(screen.getByLabelText('Nombre del negocio')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });
});
