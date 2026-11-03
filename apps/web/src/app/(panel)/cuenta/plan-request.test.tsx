import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createTranslator } from 'next-intl';
import { PLANS, type AccountInfo, type AccountRequestInfo, type PlanCode } from '@kobrax/shared';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { PlanRequest } from './plan-request';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const account = (planCode: PlanCode): AccountInfo => ({
  id: 'acc-1',
  businessName: 'Cobranzas Pérez',
  taxId: null,
  accountType: 'BUSINESS',
  status: 'ACTIVE',
  planCode,
  countryCode: 'BO',
  currencyCode: 'BOB',
  timezone: 'America/La_Paz',
  currencyDecimals: 2,
  limits: PLANS[planCode].limits,
  usage: { users: 1, credits: 10, clients: 10, photosPerMonth: 4, actionsPerMonth: 2 },
});

const request = (over: Partial<AccountRequestInfo> = {}): AccountRequestInfo => ({
  id: 'r1',
  type: 'PLAN_CHANGE',
  status: 'PENDING',
  plan: 'PROFESSIONAL',
  note: null,
  handledNote: null,
  createdAt: '2026-10-21T12:00:00.000Z',
  handledAt: null,
  ...over,
});

function renderIt(plan: PlanCode, requests: AccountRequestInfo[] = [], permissions = ['account:read', 'account:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <PlanRequest account={account(plan)} requests={requests} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => refresh.mockClear());

describe('PlanRequest — quien trabaja solo (plan individual)', () => {
  it('invita a pasar de trabajar solo a trabajar en equipo, con lo que gana (números del catálogo)', () => {
    renderIt('FREE');
    expect(screen.getByRole('heading', { name: 'Pasa de trabajar solo a trabajar en equipo' })).toBeInTheDocument();
    expect(screen.getByText(/Con Professional pasas de 1 a 25 miembros y de 20 a 1\.?000 créditos activos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver planes de equipo' })).toBeInTheDocument();
  });

  it('abre con el primer plan de equipo ya elegido', async () => {
    renderIt('FREE');
    await userEvent.click(screen.getByRole('button', { name: 'Ver planes de equipo' }));
    expect(screen.getByRole('radio', { name: /Professional/ })).toBeChecked();
  });

  it('no ofrece el plan individual que ya tiene: solo el grupo Equipo', async () => {
    renderIt('FREE');
    await userEvent.click(screen.getByRole('button', { name: 'Ver planes de equipo' }));
    expect(screen.queryByRole('radiogroup', { name: 'Individual' })).not.toBeInTheDocument();
    const equipo = screen.getByRole('radiogroup', { name: 'Equipo' });
    expect(within(equipo).getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByRole('radio', { name: /Free/ })).not.toBeInTheDocument();
  });

  it('cada plan muestra lo que incluye para poder compararlos', async () => {
    renderIt('FREE');
    await userEvent.click(screen.getByRole('button', { name: 'Ver planes de equipo' }));
    const business = screen.getByRole('radio', { name: /Business/ }).closest('label')!;
    expect(business).toHaveTextContent('100 miembros');
    expect(business).toHaveTextContent('5000 créditos activos');
    expect(business).toHaveTextContent('25.000 fotos al mes');
  });

  it('manda el plan elegido y la nota', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/account/requests', async ({ request: req }) => {
        enviado = await req.json();
        return HttpResponse.json(request());
      }),
    );
    renderIt('FREE');
    await userEvent.click(screen.getByRole('button', { name: 'Ver planes de equipo' }));
    await userEvent.click(screen.getByRole('radio', { name: /Business/ }));
    await userEvent.type(screen.getByLabelText(/Algo que debamos saber/), ' Somos 40 ');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText('Pedido enviado')).toBeInTheDocument();
    expect(enviado).toEqual({ type: 'PLAN_CHANGE', plan: 'BUSINESS', note: 'Somos 40' });
    expect(refresh).toHaveBeenCalled();
  });
});

describe('PlanRequest — quien ya trabaja en equipo', () => {
  it('no se le dice «pasa a equipo»: se le ofrece cambiar de plan, con Individual y los otros planes de Equipo', async () => {
    renderIt('PROFESSIONAL');
    expect(screen.queryByText('Pasa de trabajar solo a trabajar en equipo')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pedir cambio de plan' }));

    expect(within(screen.getByRole('radiogroup', { name: 'Individual' })).getAllByRole('radio')).toHaveLength(1);
    expect(within(screen.getByRole('radiogroup', { name: 'Equipo' })).getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: /Professional/ })).not.toBeInTheDocument();
  });
});

describe('PlanRequest — estado del pedido', () => {
  it('con un pedido pendiente lo dice y ya no deja pedir otro', () => {
    renderIt('FREE', [request()]);
    expect(screen.getByRole('status')).toHaveTextContent(/Pediste pasar a Professional/);
    expect(screen.queryByRole('button', { name: 'Ver planes de equipo' })).not.toBeInTheDocument();
  });

  it('muestra cómo terminó el último pedido y su nota, y deja pedir otro', () => {
    renderIt('FREE', [request({ status: 'HANDLED', handledNote: 'Listo, ya es Professional' })]);
    expect(screen.getByText(/ya fue atendido/)).toHaveTextContent('Listo, ya es Professional');
    expect(screen.getByRole('button', { name: 'Ver planes de equipo' })).toBeInTheDocument();
  });

  it('muestra el error del servidor (p. ej. ya había uno pendiente)', async () => {
    server.use(
      http.post('*/api/account/requests', () =>
        HttpResponse.json({ error: { code: 'REQUEST_ALREADY_PENDING', message: 'Ya hay un pedido igual esperando respuesta.' } }, { status: 409 }),
      ),
    );
    renderIt('FREE');
    await userEvent.click(screen.getByRole('button', { name: 'Ver planes de equipo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay un pedido igual esperando respuesta.');
  });

  it('sin permiso de escritura no hay botón de pedir', () => {
    renderIt('FREE', [], ['account:read']);
    expect(screen.queryByRole('button', { name: 'Ver planes de equipo' })).not.toBeInTheDocument();
  });
});

describe('textos del cambio de plan', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s: se formatean con números reales', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'account.planRequest' });
    const out = [
      t('soloGain', { plan: 'Professional', fromUsers: 1, toUsers: 25, fromCredits: 20, toCredits: 1000 }),
      t('features.members', { n: 1 }),
      t('features.members', { n: 25 }),
      t('features.credits', { n: 5000 }),
      t('currentIs', { plan: 'Free' }),
    ];
    for (const text of out) {
      expect(text).not.toContain('account.planRequest');
      expect(text).not.toContain('{');
    }
  });
});
