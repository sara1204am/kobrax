import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { DashboardDefinition } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { DASHBOARD_VIEW_COOKIE } from '@/lib/dashboard';
import { DashboardTabs } from './dashboard-tabs';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams('from=2026-11-01&to=2026-11-07'),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const board = (id: string, name: string): DashboardDefinition => ({ id, name, isDefault: false, widgets: [] });
const BOARDS = [board('d1', 'Indicadores'), board('d2', 'Gráficos'), board('d3', 'Agenda')];

describe('DashboardTabs', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    document.cookie = `${DASHBOARD_VIEW_COOKIE}=; max-age=0; path=/`;
  });

  it('una pestaña por tablero, con la actual marcada, y conserva los filtros del período', () => {
    render(<DashboardTabs dashboards={BOARDS} currentId="d2" />);
    const tabs = screen.getAllByRole('link');
    expect(tabs.map((a) => a.textContent)).toEqual(['Indicadores', 'Gráficos', 'Agenda']);
    expect(screen.getByRole('link', { name: 'Gráficos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Agenda' })).not.toHaveAttribute('aria-current');
    const href = screen.getByRole('link', { name: 'Agenda' }).getAttribute('href')!;
    expect(href).toContain('view=d3');
    expect(href).toContain('from=2026-11-01');
    expect(href).toContain('to=2026-11-07');
  });

  it('al elegir una pestaña se recuerda para la próxima vez', async () => {
    render(<DashboardTabs dashboards={BOARDS} currentId="d1" />);
    await userEvent.click(screen.getByRole('link', { name: 'Agenda' }));
    expect(document.cookie).toContain(`${DASHBOARD_VIEW_COOKIE}=d3`);
  });

  it('el «+» crea un tablero vacío con ese nombre y entra en modo edición', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/dashboards', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'nuevo', name: 'Cobranza', isDefault: false, widgets: [] });
      }),
    );
    render(<DashboardTabs dashboards={BOARDS} currentId="d1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo tablero' }));
    await userEvent.type(screen.getByLabelText('Nombre del tablero'), ' Cobranza ');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    expect(body).toEqual({ name: 'Cobranza', widgets: [] });
    const target = push.mock.calls[0]![0] as string;
    expect(target).toContain('view=nuevo');
    expect(target).toContain('edit=1');
  });

  it('sin nombre no se puede crear', async () => {
    render(<DashboardTabs dashboards={BOARDS} currentId="d1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo tablero' }));
    expect(screen.getByRole('button', { name: 'Crear' })).toBeDisabled();
  });
});
