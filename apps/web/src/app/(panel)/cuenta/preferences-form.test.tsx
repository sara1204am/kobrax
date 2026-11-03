import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { DEFAULT_PREFERENCES, PLANS, type AccountInfo } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { PreferencesForm } from './preferences-form';
import { SaveBarProvider } from './save-bar';

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
  preferences: DEFAULT_PREFERENCES,
};

function renderIt(permissions = ['account:read', 'account:write'], withBar = false) {
  const form = <PreferencesForm account={ACCOUNT} />;
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>{withBar ? <SaveBarProvider>{form}</SaveBarProvider> : form}</ToastProvider>
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

describe('PreferencesForm', () => {
  it('muestra lo guardado: lunes a sábado marcados, domingo no', () => {
    renderIt();
    expect(screen.getByRole('checkbox', { name: /lunes/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /sábado/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /domingo/i })).not.toBeChecked();
    expect(screen.getByLabelText('Inicio de la jornada')).toHaveValue('08:00');
  });

  it('sin tocar nada, guardar está apagado', () => {
    renderIt();
    expect(screen.getByRole('button', { name: 'Guardar preferencias' })).toBeDisabled();
  });

  it('manda sólo lo que cambió, dentro de «preferences»', async () => {
    const enviados: unknown[] = [];
    server.use(capture(enviados));
    renderIt();

    await userEvent.click(screen.getByRole('checkbox', { name: /domingo/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));

    expect(enviados).toEqual([{ preferences: { workDays: [1, 2, 3, 4, 5, 6, 7] } }]);
    expect(await screen.findByText('Preferencias guardadas')).toBeInTheDocument();
  });

  it('cambiar la semana a domingo manda sólo weekStart', async () => {
    const enviados: unknown[] = [];
    server.use(capture(enviados));
    renderIt();

    await userEvent.selectOptions(screen.getByLabelText('La semana empieza el'), 'SUN');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));

    expect(enviados).toEqual([{ preferences: { weekStart: 'SUN' } }]);
  });

  it('🔴 una jornada que termina antes de empezar lo dice y no deja guardar', async () => {
    renderIt();
    const fin = screen.getByLabelText('Fin de la jornada');
    await userEvent.clear(fin);
    await userEvent.type(fin, '07:00');

    expect(screen.getByRole('alert')).toHaveTextContent('La jornada tiene que terminar después de empezar.');
    expect(screen.getByRole('button', { name: 'Guardar preferencias' })).toBeDisabled();
  });

  it('sin ningún día elegido lo dice y no deja guardar', async () => {
    renderIt();
    for (const dia of [/lunes/i, /martes/i, /miércoles/i, /jueves/i, /viernes/i, /sábado/i]) {
      await userEvent.click(screen.getByRole('checkbox', { name: dia }));
    }
    expect(screen.getByRole('alert')).toHaveTextContent('Elige al menos un día de trabajo.');
    expect(screen.getByRole('button', { name: 'Guardar preferencias' })).toBeDisabled();
  });

  it('muestra el mensaje del servidor si rechaza', async () => {
    server.use(
      http.patch('*/api/account/me', () =>
        HttpResponse.json({ error: { code: 'PREFERENCES_INVALID', message: 'Las preferencias de trabajo no son válidas' } }, { status: 400 }),
      ),
    );
    renderIt();
    await userEvent.selectOptions(screen.getByLabelText('La semana empieza el'), 'SUN');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Las preferencias de trabajo no son válidas');
  });

  it('dentro de la barra de guardado no dibuja su botón y la barra guarda por él', async () => {
    const enviados: unknown[] = [];
    server.use(capture(enviados));
    renderIt(undefined, true);
    expect(screen.queryByRole('button', { name: 'Guardar preferencias' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/Idioma por defecto/), 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviados).toEqual([{ preferences: { defaultLocale: 'en' } }]);
  });

  it('sin permiso de escritura es de lectura', () => {
    renderIt(['account:read']);
    expect(screen.getByRole('checkbox', { name: /lunes/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar preferencias' })).not.toBeInTheDocument();
  });
});
