import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AccountInfo } from '@kobrax/shared';
import { OnboardingWizard } from './onboarding-wizard';

const { sendJson, refresh } = vi.hoisted(() => ({ sendJson: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/client', () => ({ sendJson }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const account = (planCode = 'FREE', usage = { users: 1, branches: 1 }): AccountInfo =>
  ({
    id: 'a1',
    planCode,
    workspace: undefined,
    usage: { ...usage, credits: 0, clients: 0, photosPerMonth: 0, actionsPerMonth: 0 },
  }) as unknown as AccountInfo;

const click = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const next = () => click('Siguiente');
const sw = (name: string) => screen.getByRole('switch', { name });

beforeEach(() => {
  sendJson.mockReset();
  refresh.mockReset();
  sendJson.mockResolvedValue({ ok: true, status: 200, data: {} });
});

describe('OnboardingWizard (F15 · P7)', () => {
  it('abre en el paso 1 con la recomendación por plan y su razón (D-12)', () => {
    render(<OnboardingWizard account={account('FREE')} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Te damos la bienvenida a Kobrax' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 8')).toBeInTheDocument();
    expect(screen.getByText(/trabajas solo, así que mostramos lo esencial/)).toBeInTheDocument();
  });

  it.each([
    ['PROFESSIONAL', /pensado para un equipo/],
    ['BUSINESS', /dejamos todo visible/],
    ['ENTERPRISE', /vista sencilla/],
  ])('la recomendación para %s se explica', (plan, text) => {
    render(<OnboardingWizard account={account(plan)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('🔴 «Usar la configuración recomendada y terminar» escribe UNA vez (preset del plan + resolución) y pasa al paso final', async () => {
    render(<OnboardingWizard account={account('FREE')} />);
    await click('Usar la configuración recomendada y terminar');
    expect(sendJson).toHaveBeenCalledTimes(1);
    const [url, body, method] = sendJson.mock.calls[0]!;
    expect(url).toBe('/api/account/me');
    expect(method).toBe('PATCH');
    expect(body.workspace.hiddenModules).toEqual([
      'import',
      'routes',
      'export',
      'organization',
      'team',
      'activity',
    ]);
    expect(body.onboarding).toEqual({ status: 'done', preset: 'independent' });
    expect(await screen.findByRole('heading', { name: 'Listo' })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); // el panel se refresca recién al entrar
  });

  it('el atajo está en todos los pasos', async () => {
    render(<OnboardingWizard account={account()} />);
    for (let i = 0; i < 6; i++) {
      expect(
        screen.getByRole('button', { name: 'Usar la configuración recomendada y terminar' }),
      ).toBeInTheDocument();
      await next();
    }
  });

  it('🔴 nada se escribe hasta confirmar: recorrer los pasos no llama al servidor', async () => {
    render(<OnboardingWizard account={account()} />);
    await click(/^Independiente/);
    await next(); // menú
    await next(); // cómo trabajas
    await next(); // ficha
    await next(); // créditos
    await next(); // vista previa
    await next(); // confirmar
    expect(screen.getByRole('heading', { name: 'Confirmar' })).toBeInTheDocument();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('flujo manual completo: elegir, previsualizar, confirmar y entrar', async () => {
    render(<OnboardingWizard account={account('PROFESSIONAL')} />);
    await next(); // → menú
    await userEvent.click(sw('Rutas'));
    await next(); // → cómo trabajas
    expect(sw('¿Haces visitas a tus clientes?')).not.toBeChecked(); // lo que se apagó en el menú se refleja
    await userEvent.click(sw('¿Trabajas con un equipo?'));
    await next(); // → ficha de clientes
    await userEvent.click(sw('Garantes'));
    await next(); // → créditos
    await userEvent.click(screen.getByRole('radio', { name: /Cuota acordada/ }));
    await next(); // → vista previa
    expect(screen.getByRole('heading', { name: 'Vista previa' })).toBeInTheDocument();
    expect(screen.getByText(/Garantes del cliente/)).toBeInTheDocument();
    expect(
      screen.getByText(/Los créditos se crean siempre como: Cuota acordada/),
    ).toBeInTheDocument();
    await next(); // → confirmar
    expect(
      screen.getByText('Esto no cambia permisos, planes ni datos: solo qué se muestra.'),
    ).toBeInTheDocument();
    await click('Guardar y terminar');
    const body = sendJson.mock.calls[0]![1];
    expect(body.workspace.hiddenModules.sort()).toEqual(['activity', 'routes', 'team']);
    expect(body.workspace.options).toEqual({
      'client.guarantors': false,
      'credit.definition': 'agreed_installment',
    });
    expect(body.onboarding.status).toBe('done');
    expect(await screen.findByRole('heading', { name: 'Listo' })).toBeInTheDocument();
    await click('Entrar a Kobrax');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('con una cuenta de varias personas, Equipo y Actividad no se pueden ocultar y se explica por qué', async () => {
    render(<OnboardingWizard account={account('PROFESSIONAL', { users: 4, branches: 1 })} />);
    await next();
    expect(sw('Equipo')).toBeDisabled();
    expect(sw('Actividad')).toBeDisabled();
    expect(sw('Rutas')).toBeEnabled();
  });

  it('los pasos 2 a 5 se omiten uno por uno sin cambiar nada', async () => {
    render(<OnboardingWizard account={account()} />);
    await next();
    await userEvent.click(sw('Rutas'));
    await click('Dejar como está');
    expect(screen.getByRole('heading', { name: 'Cómo trabajas' })).toBeInTheDocument();
  });

  it('Atrás vuelve y conserva el borrador', async () => {
    render(<OnboardingWizard account={account()} />);
    await next();
    await userEvent.click(sw('Rutas'));
    await next();
    await click('Atrás');
    expect(sw('Rutas')).not.toBeChecked();
  });

  it('🔴 «Hacerlo después» (la X) solo marca el asistente como omitido: no toca el espacio de trabajo', async () => {
    render(<OnboardingWizard account={account()} />);
    await next();
    await userEvent.click(sw('Rutas'));
    await click('Hacerlo después');
    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(sendJson.mock.calls[0]![1]).toEqual({ onboarding: { status: 'skipped' } });
    expect(refresh).toHaveBeenCalled();
  });

  it('Esc solo sale en el primer paso: más adelante no descarta el borrador', async () => {
    render(<OnboardingWizard account={account()} />);
    await next();
    screen.getByRole('dialog').focus();
    await userEvent.keyboard('{Escape}');
    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Tu menú' })).toBeInTheDocument();
  });

  it('abierto desde Cuenta, «Hacerlo después» solo cierra: no resuelve nada en el servidor', async () => {
    const onClose = vi.fn();
    render(<OnboardingWizard account={account()} onClose={onClose} />);
    await click('Hacerlo después');
    expect(onClose).toHaveBeenCalled();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('🔴 el atajo «recomendada» respeta el punto de partida que la persona tocó', async () => {
    render(<OnboardingWizard account={account('FREE')} />);
    await click(/^Completo/);
    expect(screen.getByRole('button', { name: /^Completo/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await click('Usar la configuración recomendada y terminar');
    expect(sendJson.mock.calls[0]![1]).toEqual({
      onboarding: { status: 'done', preset: 'complete' },
    });
  });

  it('el Tab no sale del diálogo: del último botón vuelve al primero', async () => {
    render(<OnboardingWizard account={account()} />);
    const buttons = within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .filter((b) => !b.hasAttribute('disabled'));
    buttons[buttons.length - 1]!.focus();
    await userEvent.tab();
    expect(buttons[0]).toHaveFocus();
  });

  it('en el menú, «Equipo» también oculta Actividad (igual que en «Cómo trabajas»)', async () => {
    render(<OnboardingWizard account={account()} />);
    await next();
    await userEvent.click(sw('Equipo'));
    expect(sw('Actividad')).not.toBeChecked();
  });

  it('Esc equivale a «Hacerlo después»', async () => {
    render(<OnboardingWizard account={account()} />);
    screen.getByRole('dialog').focus();
    await userEvent.keyboard('{Escape}');
    expect(sendJson).toHaveBeenCalledWith(
      '/api/account/me',
      { onboarding: { status: 'skipped' } },
      'PATCH',
    );
  });

  it.each([
    ['WORKSPACE_CONFLICT', /Otra persona cambió la configuración/],
    ['WORKSPACE_BLOCKED', /algo que tu cuenta todavía usa/],
    ['WORKSPACE_INVALID', /no es válida/],
    ['OTRO', /No se pudo guardar/],
  ])('si el servidor responde %s se explica y NO se avanza', async (code, text) => {
    sendJson.mockResolvedValue({ ok: false, status: 409, data: { error: { code } } });
    render(<OnboardingWizard account={account()} />);
    await click('Usar la configuración recomendada y terminar');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(
      screen.getByRole('heading', { name: 'Te damos la bienvenida a Kobrax' }),
    ).toBeInTheDocument();
  });

  it('el conflicto ofrece recargar', async () => {
    sendJson.mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: { code: 'WORKSPACE_CONFLICT' } },
    });
    render(<OnboardingWizard account={account()} />);
    await click('Usar la configuración recomendada y terminar');
    await click('Recargar');
    expect(refresh).toHaveBeenCalled();
  });

  it('con la red caída (status 0) no se rompe: muestra el error genérico', async () => {
    sendJson.mockResolvedValue({ ok: false, status: 0, data: {} });
    render(<OnboardingWizard account={account()} />);
    await click('Usar la configuración recomendada y terminar');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
  });

  it('accesibilidad: diálogo modal con título asociado y el foco va al título de cada paso', async () => {
    render(<OnboardingWizard account={account()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Te damos la bienvenida a Kobrax');
    await next();
    expect(screen.getByRole('heading', { name: 'Tu menú' })).toHaveFocus();
  });
});
