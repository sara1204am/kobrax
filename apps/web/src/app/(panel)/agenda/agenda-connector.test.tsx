import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgendaListItem } from '@kobrax/shared';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { AgendaConnector } from './agenda-connector';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/agenda',
  useSearchParams: () => new URLSearchParams(''),
}));

const item = (over: Partial<AgendaListItem> = {}): AgendaListItem =>
  ({
    id: 'a1',
    clientId: 'c1',
    creditId: 'cr1',
    assigneeId: 'u1',
    type: 'CALL',
    status: 'SCHEDULED',
    scheduledDate: '2026-10-07T00:00:00.000Z',
    timeMode: 'FIXED',
    scheduledTime: '09:00',
    details: {},
    isOverdue: false,
    clientName: 'Ana Paz',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }) as unknown as AgendaListItem;

function renderConnector(items: AgendaListItem[]) {
  server.use(http.get('*/api/agenda/context/:id', () => HttpResponse.json({ contacts: [], locations: [] })));
  return render(
    <ToastProvider>
      <AgendaConnector
        day="2026-10-07"
        today="2026-10-07"
        items={items}
        monthItems={items}
        overdue={[]}
        overdueTotal={0}
        members={[]}
        supervises={false}
        dialogs={{ canWrite: true, cancelReasons: [{ code: 'X', label: 'Lo pidió' }], rescheduleReasons: [{ code: 'X', label: 'Lo pidió' }], reasons: [], templates: [] }}
      />
    </ToastProvider>,
  );
}

async function pick(option: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Acciones de la gestión' }));
  await userEvent.click(screen.getByRole('menuitem', { name: option }));
}

describe('Agenda · menú «⋮» abre el diálogo SIN salir de la lista', () => {
  it('«Registrar la ejecución» abre el diálogo y no navega al detalle', async () => {
    push.mockClear();
    renderConnector([item()]);
    await pick('Registrar la ejecución');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('cancelar y reagendar tampoco navegan', async () => {
    push.mockClear();
    renderConnector([item()]);
    await pick('Cancelar');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Cancelar/).length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('una visita se completa desde el detalle (su parada de ruta lleva GPS y evidencia): ahí sí navega', async () => {
    push.mockClear();
    renderConnector([item({ type: 'VISIT' as never })]);
    await pick('Registrar la ejecución');
    expect(push).toHaveBeenCalledWith('/agenda/a1?accion=completar');
  });
});
