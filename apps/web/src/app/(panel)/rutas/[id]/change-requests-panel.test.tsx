import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { RouteChangeRequestItem } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { ChangeRequestsPanel } from './change-requests-panel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const req = (over: Partial<RouteChangeRequestItem> = {}): RouteChangeRequestItem => ({
  id: 'q1',
  routeId: 'r1',
  requestedBy: 'u-pide',
  requestedByName: 'Rosa Aliaga',
  kind: 'REMOVE_STOP',
  payload: { stopId: 's1' },
  reason: 'El cliente se mudó',
  status: 'PENDING',
  createdAt: '2026-10-08T09:00:00.000Z',
  ...over,
});

function capture(method: 'patch') {
  const sent: Record<string, unknown>[] = [];
  server.use(
    http[method]('*/api/routes/r1/change-requests/q1', async ({ request }) => {
      sent.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 'q1' });
    }),
  );
  return sent;
}

describe('ChangeRequestsPanel (F4/12 · decisión 1)', () => {
  it('sin pedidos no dibuja nada: una ruta sin pedidos no gana un recuadro vacío', () => {
    const { container } = render(<ChangeRequestsPanel routeId="r1" requests={[]} isOwner viewerId="u1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('quien armó la ruta ve quién pide qué y por qué, y puede aprobar o rechazar', () => {
    render(<ChangeRequestsPanel routeId="r1" requests={[req()]} isOwner viewerId="u1" />);
    expect(screen.getByText(/Quitar una parada/)).toBeInTheDocument();
    expect(screen.getByText(/Rosa Aliaga/)).toBeInTheDocument();
    expect(screen.getByText(/«El cliente se mudó»/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirar' })).toBeNull();
  });

  it('aprobar manda la decisión (la nota es opcional)', async () => {
    const sent = capture('patch');
    render(<ChangeRequestsPanel routeId="r1" requests={[req()]} isOwner viewerId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar' }));
    await vi.waitFor(() => expect(sent).toEqual([{ decision: 'APPROVE' }]));
  });

  it('rechazar con una nota la manda', async () => {
    const sent = capture('patch');
    render(<ChangeRequestsPanel routeId="r1" requests={[req()]} isOwner viewerId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Esa parada se queda');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }));
    await vi.waitFor(() => expect(sent).toEqual([{ decision: 'REJECT', note: 'Esa parada se queda' }]));
  });

  it('quien lo pidió puede retirarlo; no aprueba ni rechaza su propio pedido', async () => {
    const sent = capture('patch');
    render(<ChangeRequestsPanel routeId="r1" requests={[req()]} isOwner={false} viewerId="u-pide" />);
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retirar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retirar' }));
    await vi.waitFor(() => expect(sent).toEqual([{ decision: 'WITHDRAW' }]));
  });

  it('un tercero sin autoría ni pedido propio no ve ninguna acción', () => {
    render(<ChangeRequestsPanel routeId="r1" requests={[req()]} isOwner={false} viewerId="u-otro" />);
    expect(screen.queryByRole('button', { name: /Aprobar|Rechazar|Retirar/ })).toBeNull();
  });

  it('si la API dice que ya no se puede aplicar, el mensaje se muestra y el diálogo sigue abierto', async () => {
    server.use(
      http.patch('*/api/routes/r1/change-requests/q1', () =>
        HttpResponse.json({ error: { code: 'ROUTE_REQUEST_STALE', message: 'No se puede aplicar el cambio: La parada ya fue gestionada' } }, { status: 422 }),
      ),
    );
    render(<ChangeRequestsPanel routeId="r1" requests={[req()]} isOwner viewerId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('La parada ya fue gestionada');
  });

  it('los pedidos resueltos quedan en un historial plegado', () => {
    render(
      <ChangeRequestsPanel
        routeId="r1"
        requests={[req(), req({ id: 'q0', status: 'REJECTED', decisionNote: 'No va', kind: 'CANCEL' })]}
        isOwner
        viewerId="u1"
      />,
    );
    expect(screen.getByText('Ver el último pedido resuelto')).toBeInTheDocument();
    expect(screen.getByText('Rechazado')).toBeInTheDocument();
  });
});
