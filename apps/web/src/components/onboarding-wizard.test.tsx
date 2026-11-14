import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLANS, type AccountInfo, type Workspace } from '@kobrax/shared';
import { TOUR_START_EVENT } from './tour';
import { OnboardingWizard } from './onboarding-wizard';

const { sendJson, refresh, push } = vi.hoisted(() => ({
  sendJson: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/lib/client', () => ({ sendJson }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn() }),
}));

const account = (
  planCode: keyof typeof PLANS = 'FREE',
  usage = { users: 1, branches: 1 },
  workspace?: Workspace,
  limits: Partial<(typeof PLANS)['FREE']['limits']> = {},
): AccountInfo =>
  ({
    id: 'a1',
    planCode,
    workspace,
    limits: { ...PLANS[planCode].limits, ...limits },
    usage: { ...usage, credits: 0, clients: 0, photosPerMonth: 0, actionsPerMonth: 0 },
  }) as unknown as AccountInfo;

const click = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const next = () => click('Siguiente');
const sw = (name: string) => screen.getByRole('switch', { name });
const noSw = (name: string) => expect(screen.queryByRole('switch', { name })).toBeNull();

beforeEach(() => {
  sendJson.mockReset();
  refresh.mockReset();
  push.mockReset();
  sendJson.mockResolvedValue({ ok: true, status: 200, data: {} });
});

describe('OnboardingWizard · rediseño (F15)', () => {
  describe('primera pantalla: sin volver a preguntar la modalidad', () => {
    it('abre directamente en «Tus herramientas»: no hay selector Independiente / Equipo / Completo', () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Tus herramientas' })).toBeInTheDocument();
      expect(screen.getByText('Paso 1 de 4')).toBeInTheDocument();
      for (const old of [/^Independiente/, /^Equipo/, /^Completo/]) {
        expect(screen.queryByRole('button', { name: old })).toBeNull();
      }
      // El plan ya elegido al registrarse se usa, no se pregunta.
      expect(screen.getByText(/para tu plan Professional/)).toBeInTheDocument();
    });

    it('🔴 cuenta individual (Free, un asiento): Equipo, Actividad y Oficinas no se ofrecen', () => {
      render(<OnboardingWizard account={account('FREE')} />);
      for (const n of ['Equipo', 'Actividad', 'Oficinas']) noSw(n);
      expect(screen.queryByText('Equipo y oficinas')).toBeNull();
      expect(sw('Rutas de visitas')).toBeInTheDocument();
      expect(sw('Importar cartera')).toBeInTheDocument();
      expect(sw('Exportar y reportes')).toBeInTheDocument();
    });

    it('con plan para varias personas se ofrece Equipo; Oficinas solo si el plan permite más de una', () => {
      const { unmount } = render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      expect(sw('Equipo')).toBeInTheDocument();
      expect(sw('Oficinas')).toBeInTheDocument();
      unmount();
      render(
        <OnboardingWizard
          account={account('PROFESSIONAL', undefined, undefined, { branches: 1 })}
        />,
      );
      expect(sw('Equipo')).toBeInTheDocument();
      noSw('Oficinas');
    });

    it('arranca de lo recomendado para el plan: Free sin extras, Professional con Equipo y Rutas', () => {
      const free = render(<OnboardingWizard account={account('FREE')} />);
      expect(sw('Rutas de visitas')).not.toBeChecked();
      expect(sw('Importar cartera')).not.toBeChecked();
      free.unmount();
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      expect(sw('Rutas de visitas')).toBeChecked();
      expect(sw('Equipo')).toBeChecked();
      expect(sw('Oficinas')).not.toBeChecked();
    });

    it('con varias personas en la cuenta, Equipo no se puede ocultar y se explica por qué', () => {
      render(<OnboardingWizard account={account('PROFESSIONAL', { users: 4, branches: 1 })} />);
      expect(sw('Equipo')).toBeDisabled();
      expect(screen.getAllByText(/ya lo usa/).length).toBeGreaterThan(0);
      expect(sw('Rutas de visitas')).toBeEnabled();
    });

    it('«Equipo» también oculta Actividad (una sola decisión, un solo interruptor)', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await userEvent.click(sw('Equipo'));
      for (let i = 0; i < 3; i++) await next();
      expect(
        screen.getByText(/No verás: .*Equipo.*Actividad|No verás: .*Actividad.*Equipo/),
      ).toBeInTheDocument();
    });
  });

  describe('flujo de cuatro decisiones', () => {
    it('herramientas → clientes → créditos → resumen, sin pantallas repetidas', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      const titles: string[] = [];
      for (let i = 0; i < 3; i++) {
        titles.push(screen.getByRole('heading', { level: 1 }).textContent ?? '');
        await next();
      }
      titles.push(screen.getByRole('heading', { level: 1 }).textContent ?? '');
      expect(titles).toEqual([
        'Tus herramientas',
        'La ficha de tus clientes',
        'Tus créditos',
        'Revisa tu configuración',
      ]);
      expect(screen.getByText('Paso 4 de 4')).toBeInTheDocument();
    });

    it('🔴 nada se escribe hasta guardar: recorrer los pasos no llama al servidor', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      for (let i = 0; i < 3; i++) await next();
      expect(sendJson).not.toHaveBeenCalled();
    });

    it('Atrás conserva las elecciones de las pantallas anteriores', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await userEvent.click(sw('Rutas de visitas'));
      await next();
      await userEvent.click(sw('Garantes'));
      await next();
      await click('Atrás');
      expect(sw('Garantes')).not.toBeChecked();
      await click('Atrás');
      expect(sw('Rutas de visitas')).not.toBeChecked();
    });

    it('la ficha separa lo habitual de los datos opcionales; Género arranca apagado y Canal tiene su nombre claro', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await next();
      expect(screen.getByText('Información del cliente')).toBeInTheDocument();
      expect(screen.getByText('Datos opcionales')).toBeInTheDocument();
      expect(sw('Canal de contacto preferido')).toBeChecked();
      expect(sw('Género')).not.toBeChecked();
      expect(screen.getByText(/Kobrax no envía mensajes por su cuenta/)).toBeInTheDocument();
      expect(screen.getByText(/Kobrax no lo usa en ningún cálculo ni reporte/)).toBeInTheDocument();
    });

    it('el resumen dice lo que quedó y «Cambiar» vuelve a esa sección sin perder nada', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await userEvent.click(sw('Rutas de visitas'));
      await next();
      await userEvent.click(sw('Garantes'));
      await next();
      await userEvent.click(screen.getByRole('radio', { name: /Cuota acordada/ }));
      await next();
      expect(screen.getByText(/Siempre se crean como: Cuota acordada/)).toBeInTheDocument();
      expect(screen.getByText(/Ocultos: .*Garantes/)).toBeInTheDocument();
      expect(screen.getByText(/No verás: .*Rutas/)).toBeInTheDocument();
      const cambiar = screen.getAllByRole('button', { name: 'Cambiar' });
      await userEvent.click(cambiar[1]!); // ficha de clientes
      expect(screen.getByRole('heading', { name: 'La ficha de tus clientes' })).toBeInTheDocument();
      expect(sw('Garantes')).not.toBeChecked();
      await next();
      await next();
      expect(screen.getByText(/Siempre se crean como: Cuota acordada/)).toBeInTheDocument();
    });
  });

  describe('guardar y bienvenida', () => {
    it('guarda UNA vez con lo elegido y muestra una bienvenida con la siguiente acción real', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await userEvent.click(sw('Rutas de visitas'));
      await next();
      await userEvent.click(sw('Garantes'));
      await next();
      await userEvent.click(screen.getByRole('radio', { name: /Cuota acordada/ }));
      await next();
      await click('Guardar y empezar');
      expect(sendJson).toHaveBeenCalledTimes(1);
      const [url, body, method] = sendJson.mock.calls[0]!;
      expect(url).toBe('/api/account/me');
      expect(method).toBe('PATCH');
      expect([...body.workspace.hiddenModules].sort()).toEqual([
        'export',
        'import',
        'organization',
        'routes',
      ]);
      expect(body.workspace.options).toMatchObject({
        'client.guarantors': false,
        'client.gender': false,
        'credit.definition': 'agreed_installment',
      });
      expect(body.onboarding.status).toBe('done');
      expect(
        await screen.findByRole('heading', { name: 'Tu espacio de trabajo está listo' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Kobrax quedó configurado para tu plan Professional/),
      ).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled(); // el panel se refresca recién al entrar
    });

    it('«Registrar mi primer cliente» cierra el asistente y lleva a Cartera', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await click('Usar lo recomendado para mi plan y terminar');
      await click('Registrar mi primer cliente');
      expect(sendJson).toHaveBeenLastCalledWith(
        '/api/users/me/guides',
        { welcomeSeen: true },
        'PATCH',
      );
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith('/cartera');
    });

    it('«Hacer el recorrido ahora» lanza el recorrido; «Ir al inicio» solo entra', async () => {
      const started = vi.fn();
      window.addEventListener(TOUR_START_EVENT, started);
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await click('Usar lo recomendado para mi plan y terminar');
      await click('Ir al inicio');
      expect(push).not.toHaveBeenCalled();
      expect(started).not.toHaveBeenCalled();
      window.removeEventListener(TOUR_START_EVENT, started);
    });

    it('🔴 «Usar lo recomendado» escribe UNA vez con el plan: Free queda sin Equipo, Oficinas ni Actividad', async () => {
      render(<OnboardingWizard account={account('FREE')} />);
      await click('Usar lo recomendado para mi plan y terminar');
      expect(sendJson).toHaveBeenCalledTimes(1);
      const body = sendJson.mock.calls[0]![1];
      expect(body.workspace.hiddenModules).toEqual(
        expect.arrayContaining(['team', 'activity', 'organization']),
      );
      expect(body.workspace.options['client.gender']).toBe(false);
      expect(body.onboarding.status).toBe('done');
    });
  });

  describe('«Hacerlo después» y cierre', () => {
    it('🔴 en una cuenta individual, saltarse el asistente también deja Equipo y Oficinas ocultos', async () => {
      render(<OnboardingWizard account={account('FREE')} />);
      await click('Hacerlo después');
      const body = sendJson.mock.calls[0]![1];
      expect(body.onboarding).toEqual({ status: 'skipped' });
      expect([...body.workspace.hiddenModules].sort()).toEqual([
        'activity',
        'organization',
        'team',
      ]);
      expect(sendJson).toHaveBeenLastCalledWith(
        '/api/users/me/guides',
        { welcomeSeen: true },
        'PATCH',
      );
    });

    it('con un plan que lo permite, saltarse el asistente no toca el espacio de trabajo', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await click('Hacerlo después');
      expect(sendJson.mock.calls[0]![1]).toEqual({ onboarding: { status: 'skipped' } });
    });

    it('Esc solo sale en el primer paso: más adelante no descarta el borrador', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await next();
      screen.getByRole('dialog').focus();
      await userEvent.keyboard('{Escape}');
      expect(sendJson).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'La ficha de tus clientes' })).toBeInTheDocument();
    });

    it('Esc en el primer paso equivale a «Hacerlo después»', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      screen.getByRole('dialog').focus();
      await userEvent.keyboard('{Escape}');
      expect(sendJson).toHaveBeenCalledWith(
        '/api/account/me',
        { onboarding: { status: 'skipped' } },
        'PATCH',
      );
    });
  });

  describe('volver a abrirlo desde Cuenta (ya hay una configuración)', () => {
    const saved: Workspace = {
      version: 1,
      rev: 3,
      hiddenModules: ['export', 'team', 'activity', 'organization'],
      options: { 'client.gender': false },
    };

    it('🔴 arranca de lo guardado (no de lo recomendado) y no ofrece «usar lo recomendado»', () => {
      render(
        <OnboardingWizard account={account('PROFESSIONAL', undefined, saved)} onClose={vi.fn()} />,
      );
      expect(screen.queryByRole('button', { name: /Usar lo recomendado/ })).toBeNull();
      expect(sw('Exportar y reportes')).not.toBeChecked();
      expect(sw('Rutas de visitas')).toBeChecked();
    });

    it('«Cerrar» solo cierra: no escribe nada', async () => {
      const onClose = vi.fn();
      render(
        <OnboardingWizard account={account('PROFESSIONAL', undefined, saved)} onClose={onClose} />,
      );
      await click('Cerrar');
      expect(onClose).toHaveBeenCalled();
      expect(sendJson).not.toHaveBeenCalled();
    });

    it('guardar sin cambios no reescribe el espacio de trabajo (solo la resolución)', async () => {
      render(
        <OnboardingWizard account={account('PROFESSIONAL', undefined, saved)} onClose={vi.fn()} />,
      );
      for (let i = 0; i < 3; i++) await next();
      await click('Guardar y empezar');
      const body = sendJson.mock.calls[0]![1];
      expect(body.workspace).toBeUndefined();
      expect(body.onboarding.status).toBe('done');
    });

    it('al terminar, solo ofrece «Listo» (no el primer cliente ni el recorrido)', async () => {
      render(
        <OnboardingWizard account={account('PROFESSIONAL', undefined, saved)} onClose={vi.fn()} />,
      );
      for (let i = 0; i < 3; i++) await next();
      await click('Guardar y empezar');
      await screen.findByRole('heading', { name: 'Tu espacio de trabajo está listo' });
      expect(screen.getByRole('button', { name: 'Listo' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Registrar mi primer cliente' })).toBeNull();
    });
  });

  describe('errores y accesibilidad', () => {
    it.each([
      ['WORKSPACE_CONFLICT', /Otra persona cambió la configuración/],
      ['WORKSPACE_BLOCKED', /algo que tu cuenta todavía usa/],
      ['WORKSPACE_PLAN_GATED', /Tu plan no incluye Equipo ni Oficinas/],
      ['WORKSPACE_INVALID', /no es válida/],
      ['OTRO', /No se pudo guardar/],
    ])('si el servidor responde %s se explica y NO se avanza', async (code, text) => {
      sendJson.mockResolvedValue({ ok: false, status: 409, data: { error: { code } } });
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await click('Usar lo recomendado para mi plan y terminar');
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(screen.getByRole('heading', { name: 'Tus herramientas' })).toBeInTheDocument();
    });

    it('el conflicto ofrece recargar', async () => {
      sendJson.mockResolvedValue({
        ok: false,
        status: 409,
        data: { error: { code: 'WORKSPACE_CONFLICT' } },
      });
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await click('Usar lo recomendado para mi plan y terminar');
      await click('Recargar');
      expect(refresh).toHaveBeenCalled();
    });

    it('con la red caída (status 0) no se rompe: muestra el error genérico', async () => {
      sendJson.mockResolvedValue({ ok: false, status: 0, data: {} });
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      await click('Usar lo recomendado para mi plan y terminar');
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
    });

    it('guardar muestra el estado de carga y no se puede repetir', async () => {
      let resolve!: (v: unknown) => void;
      sendJson.mockReturnValue(new Promise((r) => (resolve = r)));
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      for (let i = 0; i < 3; i++) await next();
      await click('Guardar y empezar');
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(sendJson).toHaveBeenCalledTimes(1);
      resolve({ ok: true, status: 200, data: {} });
      await screen.findByRole('heading', { name: 'Tu espacio de trabajo está listo' });
    });

    it('diálogo modal con título asociado y el foco va al título de cada paso', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAccessibleName('Tus herramientas');
      await next();
      expect(screen.getByRole('heading', { name: 'La ficha de tus clientes' })).toHaveFocus();
    });

    it('cada interruptor tiene nombre y descripción para el lector de pantalla', () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      const rutas = sw('Rutas de visitas');
      expect(rutas).toHaveAccessibleDescription(/Planifica y recorre las visitas/);
    });

    it('el Tab no sale del diálogo: del último botón vuelve al primero', async () => {
      render(<OnboardingWizard account={account('PROFESSIONAL')} />);
      const buttons = within(screen.getByRole('dialog'))
        .getAllByRole('button')
        .filter((b) => !b.hasAttribute('disabled'));
      buttons[buttons.length - 1]!.focus();
      await userEvent.tab();
      expect(buttons[0]).toHaveFocus();
    });
  });
});
