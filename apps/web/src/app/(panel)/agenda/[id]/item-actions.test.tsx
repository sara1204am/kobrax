import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { ItemActions } from './item-actions';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));

const REASONS = [{ code: 'CLIENT_REQUEST', label: 'Lo pidió el cliente' }];

function renderActions(over: Partial<Parameters<typeof ItemActions>[0]> = {}) {
  return render(
    <ToastProvider>
      <ItemActions
        itemId="a1"
        type={'VISIT' as never}
        today="2026-10-07"
        cancelReasons={REASONS}
        rescheduleReasons={REASONS}
        canExecute
        schedule={{ timeMode: 'FIXED' as never, scheduledTime: '15:30' }}
        {...over}
      />
    </ToastProvider>,
  );
}

/** Abre «Reagendar», elige el motivo y confirma; devuelve lo que viajó a la API. */
async function reschedule(): Promise<Record<string, unknown>> {
  let enviado: Record<string, unknown> = {};
  server.use(
    http.post('*/api/agenda/a1/reschedule', async ({ request }) => {
      enviado = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ data: { id: 'a2' } });
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
  const dialog = await screen.findByRole('dialog');
  const reason = within(dialog).getAllByRole('combobox').at(-1)!;
  await userEvent.selectOptions(reason, 'CLIENT_REQUEST');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reagendar' }));
  await vi.waitFor(() => expect(enviado).toHaveProperty('reasonCode'));
  return enviado;
}

describe('ItemActions · reagendar conserva la hora (F4/11)', () => {
  it('una cita a hora exacta se reagenda con la MISMA hora, no como «por la mañana»', async () => {
    renderActions();
    const body = await reschedule();
    expect(body).toMatchObject({ timeMode: 'FIXED', scheduledTime: '15:30', reasonCode: 'CLIENT_REQUEST' });
    expect(body).not.toHaveProperty('timeSlot');
  });

  it('una gestión por franja se reagenda con su franja', async () => {
    renderActions({ schedule: { timeMode: 'LAPSE' as never, timeSlot: 'AFTERNOON' } });
    const body = await reschedule();
    expect(body).toMatchObject({ timeMode: 'LAPSE', timeSlot: 'AFTERNOON' });
    expect(body).not.toHaveProperty('scheduledTime');
  });
});

describe('ItemActions · visita que una ruta lleva (F4/11)', () => {
  it('en vez de «Registrar la ejecución» ofrece ir a la parada, y reagendar y cancelar siguen', () => {
    renderActions({ routeStopHref: '/rutas/r1/parada/s1' });
    expect(screen.getByRole('link', { name: 'Registrar en la ruta' })).toHaveAttribute('href', '/rutas/r1/parada/s1');
    expect(screen.queryByRole('button', { name: 'Registrar la ejecución' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reagendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('sin ruta, «Registrar la ejecución» abre el formulario como siempre', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'Registrar la ejecución' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Registrar en la ruta' })).toBeNull();
  });
});
