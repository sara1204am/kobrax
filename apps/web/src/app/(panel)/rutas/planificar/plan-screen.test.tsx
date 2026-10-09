import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Member, RouteItem } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import type { AvailableCredit } from '@/lib/plan';
import { PlanScreen, type PlannedVisit } from './plan-screen';

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
  usePathname: () => '/rutas/planificar',
  useSearchParams: () => new URLSearchParams(),
}));

// Los mapas son MapLibre (no corre en jsdom) y la lista es un DataTable con su propio estado: acá se prueba el FLUJO del
// planificador, así que se reemplazan por dobles mínimos que exponen lo que el flujo necesita.
vi.mock('@/components/route-map', () => ({ RouteMap: () => <div data-testid="route-map" /> }));
vi.mock('@/components/route-planner/map-panel', () => ({
  MapPanel: ({ order, onReorder }: { order: { id: string; name: string }[]; onReorder?: (id: string, to: number) => void }) => (
    <div data-testid="map-panel">
      {order.map((o, i) => (
        <span key={o.id}>
          {i + 1}. {o.name}
          {i > 0 && <button onClick={() => onReorder?.(o.id, 0)}>subir {o.name}</button>}
        </span>
      ))}
    </div>
  ),
}));
vi.mock('@/components/route-planner/available-list', () => ({
  AvailableList: ({ rows, picked, onToggle }: { rows: { id: string; clientName?: string }[]; picked: string[]; onToggle: (id: string) => void }) => (
    <ul>
      {rows.map((r) => (
        <li key={r.id}>
          <label>
            <input type="checkbox" checked={picked.includes(r.id)} onChange={() => onToggle(r.id)} />
            {r.clientName}
          </label>
        </li>
      ))}
    </ul>
  ),
}));
vi.mock('./plan-location-dialog', () => ({ PlanLocationDialog: () => null }));

const member = (userId: string, firstName: string): Member =>
  ({ userId, email: `${userId}@x.com`, firstName, lastName: 'Demo', phone: null, photoUrl: null, roleId: 'r', roleName: 'COLLECTOR', isOwner: false, isActive: true, userStatus: 'ACTIVE' }) as Member;

const HOME = { id: 'L1', locationType: 'HOME', latitude: -16.5, longitude: -68.1, address: 'Calle 12 #890' };
const credit = (id: string, name: string, locations?: AvailableCredit['locations']): AvailableCredit => ({
  id,
  clientId: `cl-${id}`,
  clientName: name,
  amount: 1000,
  currency: 'BOB',
  daysPastDue: 20,
  locations,
});

const COLLECTORS = [member('ana', 'Ana'), member('bea', 'Bea')];
const VISIT: PlannedVisit = { id: 'v1', creditId: 'c1', clientName: 'Teresa Aguilar', creditCode: 'CRD-0014', time: '09:00', priority: 'Alta' };

function setup(over: Partial<Parameters<typeof PlanScreen>[0]> = {}) {
  return render(
    <PlanScreen
      day="2026-10-09"
      today="2026-10-08"
      collectors={COLLECTORS}
      collectorId="ana"
      available={[credit('c1', 'Teresa Aguilar', [HOME]), credit('c2', 'Lidia Mamani', [{ ...HOME, id: 'L2' }]), credit('c3', 'Pedro Ticona')]}
      total={3}
      routes={[]}
      minStops={2}
      filtered={false}
      categories={[]}
      visits={[VISIT]}
      {...over}
    />,
  );
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
});

describe('PlanScreen · el planificador en cuatro pasos (F4/12)', () => {
  it('paso 1: muestra los cuatro pasos y las visitas agendadas que entran solas a la ruta', () => {
    setup();
    const steps = within(screen.getByRole('list', { name: 'Pasos para armar la ruta' }));
    for (const s of ['Fecha y cobrador', 'Clientes y ubicaciones', 'Mapa y orden', 'Vista previa']) expect(steps.getByText(s)).toBeInTheDocument();
    expect(screen.getByText('Visitas agendadas para ese día (1)')).toBeInTheDocument();
    expect(screen.getByText('Teresa Aguilar')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('Estas visitas se marcarán automáticamente en la ruta.')).toBeInTheDocument();
  });

  it('varios días: cambiar de día es un toque y va a la URL', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Mañana' }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('date=2026-10-09'));
  });

  it('🔴 la visita agendada ya viene marcada en el paso 2: es un compromiso con día', async () => {
    setup();
    await next();
    expect(screen.getByRole('checkbox', { name: 'Teresa Aguilar' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Lidia Mamani' })).not.toBeChecked();
    expect(screen.getByText('Elegidos (1)')).toBeInTheDocument();
  });

  it('cada elegido muestra a qué ubicación se va: por defecto, el domicilio del cliente', async () => {
    setup();
    await next();
    const chosen = within(screen.getByRole('complementary', { name: /Elegidos/ }));
    expect(chosen.getByText(/Domicilio · Calle 12 #890/)).toBeInTheDocument();
    expect(chosen.getByRole('button', { name: 'Cambiar la ubicación' })).toBeInTheDocument();
  });

  it('🔴 un elegido sin ubicación en el mapa se marca, es accionable y NO deja avanzar (decisión 6)', async () => {
    setup();
    await next();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pedro Ticona' }));
    const chosen = within(screen.getByRole('complementary', { name: /Elegidos/ }));
    expect(chosen.getByText('Sin ubicación en el mapa: hace falta para la ruta.')).toBeInTheDocument();
    expect(chosen.getByRole('button', { name: 'Agregar ubicación' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Falta la ubicación de 1 parada');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('sin elegir a nadie en el paso 2 no se avanza', async () => {
    setup({ visits: [] });
    await next();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('paso 3: el recorrido sale en el orden elegido y se puede reordenar arrastrando', async () => {
    setup();
    await next();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Lidia Mamani' }));
    await next();
    const map = within(screen.getByTestId('map-panel'));
    expect(map.getByText(/1\. Teresa Aguilar/)).toBeInTheDocument();
    expect(map.getByText(/2\. Lidia Mamani/)).toBeInTheDocument();
    await userEvent.click(map.getByRole('button', { name: 'subir Lidia Mamani' }));
    expect(screen.getByTestId('map-panel')).toHaveTextContent(/1\. Lidia Mamani.*2\. Teresa Aguilar/);
  });

  it('paso 4: la vista previa pide el cálculo a la API (sin guardar nada) y ofrece optimizar si ahorra', async () => {
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/routes/plan-preview', async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          geometry: [],
          distanceKm: 12.4,
          minutes: 155,
          stops: [
            { id: 'c1', sequenceOrder: 1, etaMinutes: 0, scheduledTime: '09:00' },
            { id: 'c2', sequenceOrder: 2, etaMinutes: 40 },
          ],
          suggestion: { order: ['c2', 'c1'], savedKm: 2.6, savedMinutes: 25 },
        });
      }),
    );
    setup();
    await next();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Lidia Mamani' }));
    await next();
    await next();
    expect(await screen.findByText('12.4 km')).toBeInTheDocument();
    expect(screen.getByText('2 h 35 min')).toBeInTheDocument();
    expect(sent[0]).toEqual({
      points: [
        { id: 'c1', latitude: -16.5, longitude: -68.1, scheduledTime: '09:00' },
        { id: 'c2', latitude: -16.5, longitude: -68.1 },
      ],
    });
    expect(screen.getByText(/ahorrarías 2.6 km/)).toBeInTheDocument();
    // La hora de salida por defecto es 08:30: termina 2 h 35 min después.
    expect(screen.getByText('11:05')).toBeInTheDocument();
  });

  it('🔴 la parada que llegaría tarde a su hora fija se marca: el choque se muestra siempre', async () => {
    server.use(
      http.post('*/api/routes/plan-preview', () =>
        HttpResponse.json({
          geometry: [],
          distanceKm: 5,
          minutes: 60,
          // Sale a las 08:30 y llega a los 100 min: 10:10, después de las 09:00 fijas.
          stops: [{ id: 'c1', sequenceOrder: 1, etaMinutes: 100, scheduledTime: '09:00' }],
        }),
      ),
    );
    setup();
    await next();
    await next();
    await next();
    expect(await screen.findByText('Llega tarde')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('1 parada llega después de su hora fija');
  });

  it('publicar manda el orden elegido, la ubicación de cada crédito y exige punto en todas', async () => {
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/routes/plan-preview', () => HttpResponse.json({ geometry: [], stops: [] })),
      http.post('*/api/routes/plan', async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ rows: [{ collectorId: 'ana', stops: 2, created: true }] });
      }),
    );
    setup();
    await next();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Lidia Mamani' }));
    await next();
    await next();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar y publicar (2)' }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      plannedDate: '2026-10-09',
      assignments: [{ collectorId: 'ana', creditIds: ['c1', 'c2'], locations: { c1: 'L1', c2: 'L2' } }],
      requirePoints: true,
    });
    expect(await screen.findByText(/Ruta de Ana Demo armada con 2 paradas/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('si la API rechaza la publicación se muestra el motivo y no se pierde lo armado', async () => {
    server.use(
      http.post('*/api/routes/plan-preview', () => HttpResponse.json({ geometry: [], stops: [] })),
      http.post('*/api/routes/plan', () => HttpResponse.json({ error: { code: 'ROUTE_PAST_DATE', message: 'No se arma una ruta para un día que ya pasó.' } }, { status: 422 })),
    );
    setup();
    await next();
    await next();
    await next();
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar y publicar/ }));
    expect(await screen.findByText('No se arma una ruta para un día que ya pasó.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar y publicar/ })).toBeEnabled();
  });

  it('volver a editar desde la vista previa regresa al mapa y al orden', async () => {
    server.use(http.post('*/api/routes/plan-preview', () => HttpResponse.json({ geometry: [], stops: [] })));
    setup();
    await next();
    await next();
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Volver a editar' }));
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
  });

  it('un cobrador que ya tiene su ruta ese día no se planifica de nuevo: se ofrece ir a verla', () => {
    setup({ routes: [{ id: 'r9', collectorId: 'ana', totalCases: 8 } as RouteItem] });
    expect(screen.getByRole('link', { name: 'Ir a la ruta' })).toHaveAttribute('href', '/rutas/r9');
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
  });
});
