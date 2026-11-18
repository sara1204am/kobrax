import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { emptyGuideState, GUIDE_CATALOG_VERSION, type GuideState } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { TOUR_MENU_EVENT, TourProvider, startTour, useTour } from './tour';

const nav = vi.hoisted(() => ({ path: '/dashboard' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

// jsdom no implementa <dialog> modal ni el layout: se simulan lo justo.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.getBoundingClientRect = function rect() {
    const visible = this.getAttribute('data-hidden') !== 'true';
    return (
      visible
        ? { top: 10, left: 10, width: 100, height: 30, right: 110, bottom: 40, x: 10, y: 10 }
        : { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }
    ) as DOMRect;
  };
});

let patches: Array<{ tour?: Partial<GuideState['tour']>; screens?: Record<string, string> }>;
let stored: GuideState;

beforeEach(() => {
  nav.path = '/dashboard';
  patches = [];
  stored = emptyGuideState();
  server.use(
    http.get('*/api/users/me/guides', () => HttpResponse.json({ data: stored })),
    http.patch('*/api/users/me/guides', async ({ request }) => {
      patches.push((await request.json()) as { tour?: Partial<GuideState['tour']> });
      return HttpResponse.json({ data: stored });
    }),
  );
});

function Harness({ resume = false }: { resume?: boolean }) {
  const tour = useTour();
  return (
    <>
      <button onClick={() => tour.refresh()}>refresh</button>
      <button onClick={() => tour.start(resume)}>go</button>
      <span data-testid="resume">{String(tour.resumeAt)}</span>
      <div data-tour="nav.home">home</div>
      <div data-tour="nav.portfolio">portfolio</div>
      <div data-tour="topbar.language">language</div>
      <div data-tour="topbar.help">help</div>
      <div data-tour="topbar.notifications">notifications</div>
      <div data-tour="topbar.sessionMenu">session</div>
    </>
  );
}

function Starter() {
  const tour = useTour();
  return <button onClick={() => tour.start()}>go</button>;
}

const mount = (props: Partial<React.ComponentProps<typeof TourProvider>> = {}) =>
  render(
    <TourProvider visibleNavKeys={['home', 'portfolio']} multipleAccounts={false} {...props}>
      <Harness />
    </TourProvider>,
  );

describe('Recorrido con spotlight (F15 · P9)', () => {
  it('recorre el menú visible y la barra, en orden, y al terminar guarda «done»', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText('go'));
    expect(screen.getByText('Paso 1 de 6')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('heading', { name: 'Cartera' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('heading', { name: 'Idioma' })).toBeInTheDocument();
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Paso 6 de 6')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Terminar' }));
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    await waitFor(() => expect(patches.at(-1)?.tour?.status).toBe('done'));
  });

  it('🔴 R1: un módulo que la persona no ve no aparece en el recorrido', async () => {
    const user = userEvent.setup();
    mount({ visibleNavKeys: ['home'] });
    await user.click(screen.getByText('go'));
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.queryByRole('heading', { name: 'Cartera' })).toBeNull();
  });

  it('guarda el paso al avanzar y «Atrás» vuelve', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText('go'));
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() =>
      expect(patches.at(-1)?.tour).toMatchObject({ status: 'inProgress', step: 1 }),
    );
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.getByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
  });

  it('«Omitir recorrido» lo guarda como omitido', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText('go'));
    await user.click(screen.getByRole('button', { name: 'Omitir recorrido' }));
    await waitFor(() => expect(patches.at(-1)?.tour?.status).toBe('skipped'));
  });

  it('las flechas navegan y Esc deja el recorrido a medias para retomarlo', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText('go'));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('heading', { name: 'Cartera' })).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    act(() => {
      screen
        .getByRole('heading', { name: 'Cartera' })
        .closest('dialog')!
        .dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('heading', { name: 'Cartera' })).toBeNull();
    expect(screen.getByTestId('resume')).toHaveTextContent('1');
    expect(patches.some((p) => p.tour?.status === 'skipped' || p.tour?.status === 'done')).toBe(
      false,
    );
  });

  it('«Seguir donde lo dejé» sale del estado guardado y arranca en ese paso', async () => {
    const user = userEvent.setup();
    stored = {
      ...emptyGuideState(),
      tour: { status: 'inProgress', step: 2, catalogVersion: GUIDE_CATALOG_VERSION },
    };
    render(
      <TourProvider visibleNavKeys={['home', 'portfolio']} multipleAccounts={false}>
        <Harness resume />
      </TourProvider>,
    );
    await user.click(screen.getByText('refresh'));
    await waitFor(() => expect(screen.getByTestId('resume')).toHaveTextContent('2'));
    await user.click(screen.getByText('go'));
    expect(screen.getByText('Paso 3 de 6')).toBeInTheDocument();
  });

  it('sin el catálogo vigente no se ofrece retomar', async () => {
    const user = userEvent.setup();
    stored = {
      ...emptyGuideState(),
      tour: { status: 'inProgress', step: 2, catalogVersion: GUIDE_CATALOG_VERSION + 1 },
    };
    mount();
    await user.click(screen.getByText('refresh'));
    await waitFor(() => expect(screen.getByTestId('resume')).toHaveTextContent('null'));
  });

  it('el cambio de organización solo es un paso con más de una organización', async () => {
    const user = userEvent.setup();
    mount({ multipleAccounts: true });
    await user.click(screen.getByText('go'));
    expect(screen.getByText('Paso 1 de 7')).toBeInTheDocument();
  });

  it('startTour() lo lanza desde fuera (asistente, bienvenida)', async () => {
    mount();
    act(() => startTour());
    expect(await screen.findByText('Paso 1 de 6')).toBeInTheDocument();
  });

  it('en pantallas chicas abre el cajón del menú si el ítem no está a la vista, y lo cierra en la barra', async () => {
    const user = userEvent.setup();
    const events: boolean[] = [];
    window.addEventListener(TOUR_MENU_EVENT, (e) =>
      events.push((e as CustomEvent<{ open: boolean }>).detail.open),
    );
    render(
      <TourProvider visibleNavKeys={['home']} multipleAccounts={false}>
        <div data-tour="nav.home" data-hidden="true" />
        <Starter />
      </TourProvider>,
    );
    await user.click(screen.getByText('go'));
    expect(events).toContain(true);
    // el ítem sigue sin verse (jsdom): la tarjeta sale centrada y lo dice
    expect(await screen.findByText(/no está a la vista/)).toBeInTheDocument();
  });

  describe('guías de pantalla (P10)', () => {
    function Screen({ withRegister = true }: { withRegister?: boolean }) {
      const tour = useTour();
      return (
        <>
          <span data-testid="mod">{String(tour.screenModule)}</span>
          <button onClick={() => tour.startScreen()}>screen</button>
          <div data-tour="screen.payments.list">lista</div>
          {withRegister && <div data-tour="screen.payments.register">registrar</div>}
        </>
      );
    }
    const mountScreen = (
      props: Partial<React.ComponentProps<typeof TourProvider>> = {},
      withRegister = true,
    ) =>
      render(
        <TourProvider visibleNavKeys={['payments']} multipleAccounts={false} {...props}>
          <Screen withRegister={withRegister} />
        </TourProvider>,
      );

    it('desde «?» recorre la guía de la pantalla y la marca como vista', async () => {
      const user = userEvent.setup();
      nav.path = '/pagos';
      mountScreen();
      expect(screen.getByTestId('mod')).toHaveTextContent('payments');
      await user.click(screen.getByText('screen'));
      expect(screen.getByText('Paso 1 de 2')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Pagos recibidos' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Siguiente' }));
      await user.click(screen.getByRole('button', { name: 'Terminar' }));
      await waitFor(() => expect(patches.at(-1)?.screens).toEqual({ 'screen.payments': 'seen' }));
    });

    it('un botón que la pantalla no muestra no se enseña', async () => {
      const user = userEvent.setup();
      nav.path = '/pagos/123';
      mountScreen({}, false);
      await user.click(screen.getByText('screen'));
      expect(screen.getByText('Paso 1 de 1')).toBeInTheDocument();
    });

    it('🔴 R1: sin el módulo en el menú no hay guía de pantalla', () => {
      nav.path = '/pagos';
      mountScreen({ visibleNavKeys: ['home'] });
      expect(screen.getByTestId('mod')).toHaveTextContent('null');
    });

    it('«Omitir» la guarda como descartada', async () => {
      const user = userEvent.setup();
      nav.path = '/pagos';
      mountScreen();
      await user.click(screen.getByText('screen'));
      await user.click(screen.getByRole('button', { name: 'Omitir recorrido' }));
      await waitFor(() =>
        expect(patches.at(-1)?.screens).toEqual({ 'screen.payments': 'dismissed' }),
      );
    });

    it('en una cuenta nueva con el recorrido resuelto, sale sola la primera vez', async () => {
      nav.path = '/pagos';
      stored = {
        ...emptyGuideState(),
        tour: { status: 'done', step: 0, catalogVersion: GUIDE_CATALOG_VERSION },
      };
      mountScreen({ autoScreens: true });
      expect(await screen.findByText('Paso 1 de 2', {}, { timeout: 3000 })).toBeInTheDocument();
    });

    it.each([
      ['recorrido aún sin hacer', { tour: { status: 'none', step: 0, catalogVersion: 0 } }, true],
      [
        'guía ya vista',
        {
          tour: { status: 'done', step: 0, catalogVersion: GUIDE_CATALOG_VERSION },
          screens: { 'screen.payments': 'seen' },
        },
        true,
      ],
      [
        'cuenta anterior',
        { tour: { status: 'done', step: 0, catalogVersion: GUIDE_CATALOG_VERSION } },
        false,
      ],
    ])('no sale sola: %s', async (_n, patch, auto) => {
      nav.path = '/pagos';
      stored = { ...emptyGuideState(), ...patch } as GuideState;
      mountScreen({ autoScreens: auto });
      await new Promise((r) => setTimeout(r, 1200));
      expect(screen.queryByText('Paso 1 de 2')).toBeNull();
    });
  });
});
