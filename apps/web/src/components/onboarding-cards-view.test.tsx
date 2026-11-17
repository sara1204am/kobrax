import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FirstStep } from '@kobrax/shared';
import { OnboardingCardsView, type WelcomeInfo } from './onboarding-cards-view';

const { sendJson, pathname, refresh } = vi.hoisted(() => ({
  sendJson: vi.fn(),
  pathname: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/client', () => ({ sendJson }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const welcome: WelcomeInfo = {
  orgName: 'Cobranzas Pérez',
  role: 'COLLECTOR',
  modules: ['portfolio', 'agenda'],
};
const steps: FirstStep[] = [
  { key: 'createClient', href: '/cartera', done: true },
  { key: 'createCredit', href: '/cartera', done: false },
  { key: 'registerPayment', href: '/pagos', done: false },
];

beforeEach(() => {
  sendJson.mockReset();
  refresh.mockReset();
  sendJson.mockResolvedValue({ ok: true, status: 200, data: {} });
  pathname.mockReturnValue('/dashboard');
});

describe('OnboardingCardsView (F15 · P8)', () => {
  it('la bienvenida dice la organización, el rol y lo que puede hacer, y a quién pedir ayuda', () => {
    render(<OnboardingCardsView welcome={welcome} steps={null} />);
    expect(
      screen.getByRole('heading', { name: 'Te damos la bienvenida a Cobranzas Pérez' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tu rol es Cobrador.')).toBeInTheDocument();
    expect(screen.getByText('Cartera')).toBeInTheDocument();
    expect(screen.getByText('Agenda')).toBeInTheDocument();
    expect(screen.getByText(/pídeselo a quien administra tu organización/)).toBeInTheDocument();
  });

  it('un rol personalizado (sin traducción) se muestra con su nombre', () => {
    render(
      <OnboardingCardsView welcome={{ ...welcome, role: 'Cobrador de zona norte' }} steps={null} />,
    );
    expect(screen.getByText('Tu rol es Cobrador de zona norte.')).toBeInTheDocument();
  });

  it('«Entendido» la cierra al instante y guarda solo que se vio, sin bloquear', async () => {
    render(<OnboardingCardsView welcome={welcome} steps={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('heading', { name: /bienvenida/ })).not.toBeInTheDocument();
    expect(sendJson).toHaveBeenCalledWith('/api/users/me/guides', { welcomeSeen: true }, 'PATCH');
  });

  it('los primeros pasos marcan lo hecho (tachado, sin enlace) y enlazan lo pendiente', () => {
    render(<OnboardingCardsView welcome={null} steps={steps} />);
    expect(screen.getByRole('heading', { name: 'Primeros pasos' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Registra tu primer cliente' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crea tu primer crédito' })).toHaveAttribute(
      'href',
      '/cartera',
    );
    expect(screen.getByRole('link', { name: 'Registra tu primer pago' })).toHaveAttribute(
      'href',
      '/pagos',
    );
  });

  it('cerrar los primeros pasos guarda que se cerraron', async () => {
    render(<OnboardingCardsView welcome={null} steps={steps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('heading', { name: 'Primeros pasos' })).not.toBeInTheDocument();
    expect(sendJson).toHaveBeenCalledWith(
      '/api/users/me/guides',
      { firstStepsClosed: true },
      'PATCH',
    );
  });

  it('solo se muestran en las pantallas de aterrizaje: Inicio y Agenda', () => {
    pathname.mockReturnValue('/agenda');
    const { container, rerender } = render(<OnboardingCardsView welcome={welcome} steps={steps} />);
    expect(container).not.toBeEmptyDOMElement();
    pathname.mockReturnValue('/cartera');
    rerender(<OnboardingCardsView welcome={welcome} steps={steps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('con todo hecho se da por cerrada una sola vez y no pinta nada', () => {
    const { container } = render(<OnboardingCardsView welcome={null} steps={null} closeStepsNow />);
    expect(container).toBeEmptyDOMElement();
    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledWith(
      '/api/users/me/guides',
      { firstStepsClosed: true },
      'PATCH',
    );
  });

  it('sin `closeStepsNow` no guarda nada al mostrarse', () => {
    render(<OnboardingCardsView welcome={welcome} steps={steps} />);
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('al volver a una pantalla de aterrizaje con los pasos abiertos se pide el estado de nuevo (el avance se ve marcado)', () => {
    pathname.mockReturnValue('/dashboard');
    const { rerender } = render(<OnboardingCardsView welcome={null} steps={steps} />);
    expect(refresh).not.toHaveBeenCalled(); // la primera pintura no refresca
    pathname.mockReturnValue('/cartera');
    rerender(<OnboardingCardsView welcome={null} steps={steps} />);
    expect(refresh).not.toHaveBeenCalled(); // fuera del aterrizaje no hay nada que mostrar
    pathname.mockReturnValue('/dashboard');
    rerender(<OnboardingCardsView welcome={null} steps={steps} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sin tarjeta de pasos no refresca al navegar', () => {
    pathname.mockReturnValue('/cartera');
    const { rerender } = render(<OnboardingCardsView welcome={welcome} steps={null} />);
    pathname.mockReturnValue('/agenda');
    rerender(<OnboardingCardsView welcome={welcome} steps={null} />);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('si el guardado falla, la tarjeta igual se cierra (es un recordatorio, no una pérdida)', async () => {
    sendJson.mockResolvedValue({ ok: false, status: 500, data: {} });
    render(<OnboardingCardsView welcome={welcome} steps={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('heading', { name: /bienvenida/ })).not.toBeInTheDocument();
  });
});
