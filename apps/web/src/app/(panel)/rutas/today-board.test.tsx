import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RouteStatus, type Member, type RouteItem } from '@kobrax/shared';
import { TodayBoard } from './today-board';

// Un componente de servidor pide sus textos a `next-intl/server`: se ata al diccionario real en español.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const es = (await import('@/messages/es.json')).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: 'es', messages: es, namespace }),
    getLocale: async () => 'es',
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/rutas',
  useSearchParams: () => new URLSearchParams(),
}));

const member = (userId: string, firstName: string): Member =>
  ({ userId, email: `${userId}@x.com`, firstName, lastName: 'Demo', phone: null, photoUrl: null, roleId: 'r', roleName: 'COLLECTOR', isOwner: false, isActive: true, userStatus: 'ACTIVE' }) as Member;

const route = (collectorId: string, status: RouteStatus, over: Partial<RouteItem> = {}): RouteItem =>
  ({ id: `r-${collectorId}`, collectorId, plannedDate: '2026-10-08', status, totalCases: 8, visitedCount: 0, createdAt: '2026-10-07T00:00:00Z', ...over }) as RouteItem;

const TEAM = [member('ana', 'Ana'), member('bea', 'Bea'), member('carla', 'Carla')];

async function draw(props: Partial<Parameters<typeof TodayBoard>[0]> = {}) {
  const ui = await TodayBoard({ day: '2026-10-08', routes: [], collectors: [], members: TEAM, canPlan: true, ...props });
  return render(ui);
}

describe('TodayBoard · ¿qué pasa hoy con las rutas? (F4/12)', () => {
  it('los cuatro totales salen de las rutas del día', async () => {
    const { container } = await draw({
      routes: [route('ana', RouteStatus.IN_PROGRESS, { visitedCount: 4 }), route('bea', RouteStatus.PLANNED, { totalCases: 5 })],
    });
    // Los títulos de la tabla repiten palabras («Paradas»): los totales se buscan dentro de su propia lista.
    const totals = within(container.querySelector('dl') as HTMLElement);
    const stat = (label: string) => totals.getByText(label).previousElementSibling!;
    expect(stat('Cobradores')).toHaveTextContent('2');
    expect(stat('Paradas')).toHaveTextContent('13');
    expect(stat('Gestionadas')).toHaveTextContent('4');
    expect(stat('Pendientes')).toHaveTextContent('9');
  });

  it('una fila por cobrador: en curso primero, con su avance, lo cobrado y la siguiente parada', async () => {
    await draw({
      routes: [
        route('bea', RouteStatus.PLANNED),
        route('ana', RouteStatus.IN_PROGRESS, { visitedCount: 4, collected: 608, nextStop: { id: 's5', sequenceOrder: 5, clientName: 'Norma Huanca' } }),
      ],
    });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Ana Demo');
    expect(rows[0]).toHaveTextContent('En curso');
    expect(rows[0]).toHaveTextContent('4 de 8');
    expect(rows[0]).toHaveTextContent('50%');
    expect(rows[0]).toHaveTextContent(/608/);
    expect(rows[0]).toHaveTextContent('#5 · Norma Huanca');
    expect(within(rows[0]!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(rows[1]).toHaveTextContent('Bea Demo');
  });

  it('🔴 quien administra rutas ve a los cobradores SIN ruta, con «Planificar» ya apuntado a ese día y esa persona', async () => {
    await draw({ routes: [route('ana', RouteStatus.PLANNED)], collectors: TEAM });
    const plan = screen.getAllByRole('link', { name: 'Planificar' });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toHaveAttribute('href', '/rutas/planificar?date=2026-10-08&collectorId=bea');
    expect(screen.getAllByText('Sin ruta')).toHaveLength(2);
  });

  it('sin permiso de planificar no se ofrece «Planificar»', async () => {
    await draw({ routes: [], collectors: TEAM, canPlan: false });
    expect(screen.queryByRole('link', { name: 'Planificar' })).toBeNull();
  });

  it('«Iniciar» solo en una ruta planificada que es mía; si no, «Ver»', async () => {
    await draw({
      routes: [route('ana', RouteStatus.PLANNED), route('bea', RouteStatus.PLANNED, { createdBy: 'yo' }), route('carla', RouteStatus.COMPLETED)],
      userId: 'ana',
    });
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByRole('button', { name: 'Iniciar' })).toBeInTheDocument(); // Ana: es su ruta
    expect(within(rows[1]!).getByRole('link', { name: 'Ver' })).toHaveAttribute('href', '/rutas/r-bea'); // de Bea, la armó otra
    expect(within(rows[2]!).getByRole('link', { name: 'Ver' })).toBeInTheDocument(); // completada
    expect(within(rows[2]!).queryByRole('button', { name: 'Iniciar' })).toBeNull();
  });

  it('quien armó la ruta de otra persona también puede iniciarla desde la lista', async () => {
    await draw({ routes: [route('bea', RouteStatus.PLANNED, { createdBy: 'yo' })], userId: 'yo' });
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeInTheDocument();
  });

  it('una ruta de alguien que ya no está en el equipo igual aparece', async () => {
    await draw({ routes: [route('baja', RouteStatus.PLANNED)], members: [] });
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('Cobrador');
  });

  it('la URL filtra y ordena las filas, pero los totales siguen siendo los del día', async () => {
    const { container } = await draw({
      routes: [route('ana', RouteStatus.IN_PROGRESS, { visitedCount: 4 }), route('bea', RouteStatus.PLANNED, { totalCases: 5 })],
      collectors: TEAM,
      params: { status: 'NONE' },
    });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Carla Demo');
    expect(within(container.querySelector('dl') as HTMLElement).getByText('Paradas').previousElementSibling).toHaveTextContent('13');
  });

  it('un día sin cobradores ni rutas lo dice', async () => {
    await draw();
    expect(screen.getByText('No hay cobradores ni rutas para este día.')).toBeInTheDocument();
  });

  it('todas las paradas gestionadas: «Todas gestionadas» en lugar de una parada siguiente', async () => {
    await draw({ routes: [route('ana', RouteStatus.COMPLETED, { totalCases: 3, visitedCount: 3 })] });
    expect(screen.getByText('Todas gestionadas')).toBeInTheDocument();
  });
});
