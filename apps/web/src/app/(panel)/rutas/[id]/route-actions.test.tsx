import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { RouteStatus, type RouteCapabilities } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { RouteActions } from './route-actions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const NONE: RouteCapabilities = { isOwner: false, start: false, complete: false, cancel: false, cancelBlockedByVisits: false, edit: false, requestChange: false, recordVisit: false };

function setup(over: Partial<Parameters<typeof RouteActions>[0]> & { caps?: Partial<RouteCapabilities> } = {}) {
  const { caps, ...rest } = over;
  return render(
    <RouteActions routeId="r1" status={RouteStatus.PLANNED} capabilities={{ ...NONE, ...caps }} openStops={3} viewerIsCollector={false} {...rest} />,
  );
}

/** Captura lo que viaja al BFF de estado. */
function captureStatus() {
  const sent: Record<string, unknown>[] = [];
  server.use(
    http.patch('*/api/routes/r1/status', async ({ request }) => {
      sent.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 'r1' });
    }),
  );
  return sent;
}

describe('RouteActions · solo lo que la API dice que se puede (F4/12)', () => {
  it('🔴 un botón que no se puede usar no se muestra', () => {
    setup();
    for (const name of [/Iniciar/, /Completar/, /Cancelar ruta/, /Optimizar/, /Pedir cancelar/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('el cobrador de la ruta la inicia directo, sin pedir motivo', async () => {
    const sent = captureStatus();
    setup({ caps: { start: true, cancel: true }, viewerIsCollector: true });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ruta' }));
    await vi.waitFor(() => expect(sent).toEqual([{ status: 'IN_PROGRESS' }]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('quien inicia la ruta de OTRA persona tiene que dejar el motivo', async () => {
    const sent = captureStatus();
    setup({ caps: { start: true } });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ruta' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Iniciar ruta' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'El cobrador no tiene señal');
    await userEvent.click(confirm);
    await vi.waitFor(() => expect(sent).toEqual([{ status: 'IN_PROGRESS', reason: 'El cobrador no tiene señal' }]));
  });

  it('🔴 completar con paradas sin gestionar exige el motivo y dice qué les pasa', async () => {
    const sent = captureStatus();
    setup({ status: RouteStatus.IN_PROGRESS, caps: { complete: true, isOwner: true }, viewerIsCollector: true, openStops: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Completar jornada' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Quedan 2 paradas sin gestionar/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Completar jornada' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Falta de tiempo, sigo mañana');
    await userEvent.click(confirm);
    await vi.waitFor(() => expect(sent).toEqual([{ status: 'COMPLETED', reason: 'Falta de tiempo, sigo mañana' }]));
  });

  it('completar con todo gestionado no pide motivo', async () => {
    const sent = captureStatus();
    setup({ status: RouteStatus.IN_PROGRESS, caps: { complete: true, isOwner: true }, viewerIsCollector: true, openStops: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Completar jornada' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Completar jornada' }));
    await vi.waitFor(() => expect(sent).toEqual([{ status: 'COMPLETED' }]));
  });

  it('cancelar pide confirmación y motivo, y avisa qué pasa con las paradas', async () => {
    const sent = captureStatus();
    setup({ caps: { cancel: true, isOwner: true }, viewerIsCollector: true, openStops: 4 });
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar ruta' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/pasan a saltadas/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Me enfermé');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sí, cancelar la ruta' }));
    await vi.waitFor(() => expect(sent).toEqual([{ status: 'CANCELLED', reason: 'Me enfermé' }]));
  });

  it('🔴 con visitas registradas, cancelar se muestra deshabilitado Y explica por qué: se completa', () => {
    setup({ status: RouteStatus.IN_PROGRESS, caps: { cancelBlockedByVisits: true, complete: true } });
    expect(screen.getByRole('button', { name: 'Cancelar ruta' })).toBeDisabled();
    expect(screen.getByText(/no se cancela, se completa/)).toBeInTheDocument();
  });

  it('quien no manda sobre la ruta no la cancela: pide la cancelación, con motivo', async () => {
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/routes/r1/change-requests', async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 'q1' });
      }),
    );
    setup({ caps: { requestChange: true } });
    expect(screen.queryByRole('button', { name: 'Cancelar ruta' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Pedir cancelar la ruta' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'La zona quedó bloqueada');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    await vi.waitFor(() => expect(sent).toEqual([{ kind: 'CANCEL', payload: {}, reason: 'La zona quedó bloqueada' }]));
  });

  it('el mensaje de la API se muestra tal cual (transición inválida, ruta cambiada…)', async () => {
    server.use(
      http.patch('*/api/routes/r1/status', () =>
        HttpResponse.json({ error: { code: 'ROUTE_STATE_CHANGED', message: 'La ruta cambió mientras la mirabas.' } }, { status: 409 }),
      ),
    );
    setup({ caps: { start: true }, viewerIsCollector: true });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ruta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La ruta cambió mientras la mirabas.');
  });
});
