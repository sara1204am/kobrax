import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PLANS, type AccountInfo, type AccountRequestInfo } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { PlanRequest } from './plan-request';

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
};

const request = (over: Partial<AccountRequestInfo> = {}): AccountRequestInfo => ({
  id: 'r1',
  type: 'PLAN_CHANGE',
  status: 'PENDING',
  plan: 'BUSINESS',
  note: null,
  handledNote: null,
  createdAt: '2026-10-21T12:00:00.000Z',
  handledAt: null,
  ...over,
});

function renderIt(requests: AccountRequestInfo[] = [], permissions = ['account:read', 'account:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <PlanRequest account={ACCOUNT} requests={requests} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => refresh.mockClear());

describe('PlanRequest', () => {
  it('ofrece pedir el cambio, y el plan actual no está entre las opciones', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Pedir cambio de plan' }));
    const opciones = Array.from((screen.getByLabelText('Plan que quieres') as HTMLSelectElement).options).map((o) => o.value);
    expect(opciones).toEqual(['FREE', 'BUSINESS', 'ENTERPRISE']);
  });

  it('manda el plan y la nota, y avisa que se envió', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/account/requests', async ({ request: req }) => {
        enviado = await req.json();
        return HttpResponse.json(request());
      }),
    );
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Pedir cambio de plan' }));
    await userEvent.selectOptions(screen.getByLabelText('Plan que quieres'), 'BUSINESS');
    await userEvent.type(screen.getByLabelText(/Algo que debamos saber/), ' Somos 40 ');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText('Pedido enviado')).toBeInTheDocument();
    expect(enviado).toEqual({ type: 'PLAN_CHANGE', plan: 'BUSINESS', note: 'Somos 40' });
    expect(refresh).toHaveBeenCalled();
  });

  it('con un pedido pendiente lo dice y ya no deja pedir otro', () => {
    renderIt([request()]);
    expect(screen.getByRole('status')).toHaveTextContent(/Pediste pasar a Business/);
    expect(screen.queryByRole('button', { name: 'Pedir cambio de plan' })).not.toBeInTheDocument();
  });

  it('muestra cómo terminó el último pedido y su nota, y deja pedir otro', () => {
    renderIt([request({ status: 'HANDLED', handledNote: 'Listo, ya es Business' })]);
    expect(screen.getByText(/ya fue atendido/)).toHaveTextContent('Listo, ya es Business');
    expect(screen.getByRole('button', { name: 'Pedir cambio de plan' })).toBeInTheDocument();
  });

  it('muestra el error del servidor (p. ej. ya había uno pendiente)', async () => {
    server.use(
      http.post('*/api/account/requests', () =>
        HttpResponse.json({ error: { code: 'REQUEST_ALREADY_PENDING', message: 'Ya hay un pedido igual esperando respuesta.' } }, { status: 409 }),
      ),
    );
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Pedir cambio de plan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay un pedido igual esperando respuesta.');
  });

  it('sin permiso de escritura no hay botón de pedir', () => {
    renderIt([], ['account:read']);
    expect(screen.queryByRole('button', { name: 'Pedir cambio de plan' })).not.toBeInTheDocument();
  });
});
