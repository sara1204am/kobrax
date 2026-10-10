import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { NewTaskModal } from './new-task-modal';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const CLIENT = { id: 'cl-1', firstName: 'Teresa', lastName: 'Mamani', nationalId: '***123' };

const CONTEXT = {
  client: { id: 'cl-1', displayName: 'Teresa Mamani', nationalId: null },
  credits: [
    { creditId: 'cr-mora', code: 'C-1', outstandingBalance: 1000, currency: 'BOB', daysPastDue: 12 },
    { creditId: 'cr-dia', code: 'C-2', outstandingBalance: 500, currency: 'BOB', daysPastDue: 0 },
  ],
  contacts: [{ id: 'ct-1', contactType: 'PHONE', value: '70000000', isPrimary: true }],
  locations: [],
};

async function openContext() {
  server.use(
    http.get('*/api/clients', () => HttpResponse.json({ data: [CLIENT] })),
    http.get('*/api/agenda/context/cl-1', () => HttpResponse.json(CONTEXT)),
  );
  render(
    <ToastProvider>
      <NewTaskModal open onClose={() => {}} date="2026-10-05" />
    </ToastProvider>,
  );
  await userEvent.type(screen.getByRole('textbox'), 'teresa');
  await userEvent.click(await screen.findByRole('button', { name: /Teresa Mamani/ }));
}

describe('NewTaskModal (F4/08: la gestión cuelga del crédito)', () => {
  it('lista TODOS los créditos del deudor: «En mora · N días» y «Al día»', async () => {
    await openContext();
    expect(await screen.findByRole('option', { name: /C-1 · .*En mora · 12 días/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /C-2 · .*Al día/ })).toBeInTheDocument();
  });

  it('agendar sobre un crédito al día manda sólo creditId', async () => {
    let enviado: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/agenda', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 'a1' } });
      }),
    );
    await openContext();
    const select = (await screen.findAllByRole('combobox'))[0]!;
    await userEvent.selectOptions(select, 'cr-dia');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));

    expect(enviado).toMatchObject({ creditId: 'cr-dia', type: 'CALL' });
  });
});

describe('NewTaskModal · asignar a otra persona (F4/09)', () => {
  const ASSIGNEES = [
    { userId: 'u1', firstName: 'Sandra', lastName: 'Soria', roleName: 'SUPERVISOR', branchId: 'b1' },
    { userId: 'u7', firstName: 'Rosa', lastName: 'Aliaga', roleName: 'COLLECTOR', branchId: 'b1' },
  ];

  async function openWith(assign?: { meId: string }) {
    server.use(
      http.get('*/api/clients', () => HttpResponse.json({ data: [CLIENT] })),
      http.get('*/api/agenda/context/cl-1', () => HttpResponse.json(CONTEXT)),
      http.get('*/api/agenda/assignees', () => HttpResponse.json({ data: ASSIGNEES })),
    );
    render(
      <ToastProvider>
        <NewTaskModal open onClose={() => {}} date="2026-10-05" assign={assign} />
      </ToastProvider>,
    );
    await userEvent.type(screen.getByRole('textbox'), 'teresa');
    await userEvent.click(await screen.findByRole('button', { name: /Teresa Mamani/ }));
  }

  it('un cobrador no ve el selector «Asignar a»', async () => {
    await openWith(undefined);
    await screen.findByRole('option', { name: /C-1 ·/ });
    expect(screen.queryByText('Asignar a')).not.toBeInTheDocument();
  });

  it('quien puede asignar elige a alguien y se manda assigneeId; sin elegir no se manda', async () => {
    const enviados: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/agenda', async ({ request }) => {
        enviados.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ data: { id: 'a1' } });
      }),
    );
    await openWith({ meId: 'u1' });
    expect(await screen.findByText('Asignar a')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Sandra Soria (yo)' })).toBeInTheDocument();

    const selects = await screen.findAllByRole('combobox');
    await userEvent.selectOptions(selects[1]!, 'u7');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    expect(enviados[0]).toMatchObject({ creditId: 'cr-mora', assigneeId: 'u7' });
  });
});

describe('NewTaskModal · editar (F4/09)', () => {
  const ITEM = {
    id: 'a1',
    clientId: 'cl-1',
    creditId: 'cr-dia',
    assigneeId: 'u7',
    createdBy: 'u1',
    type: 'CALL',
    status: 'SCHEDULED',
    scheduledDate: '2026-10-07T00:00:00.000Z',
    timeMode: 'FIXED',
    scheduledTime: '09:30',
    observations: 'Insistir',
    details: { contactId: 'ct-1' },
    isOverdue: false,
    createdAt: '',
    updatedAt: '',
  } as never;

  it('precarga lo guardado, no ofrece buscar otro deudor y guarda con PATCH sin día ni crédito', async () => {
    let enviado: Record<string, unknown> | undefined;
    server.use(
      http.get('*/api/agenda/context/cl-1', () => HttpResponse.json(CONTEXT)),
      http.get('*/api/agenda/assignees', () => HttpResponse.json({ data: [] })),
      http.patch('*/api/agenda/a1', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'a1' });
      }),
    );
    render(
      <ToastProvider>
        <NewTaskModal open onClose={() => {}} date="2026-10-07" editing={ITEM} assign={{ meId: 'u1' }} />
      </ToastProvider>,
    );

    expect(await screen.findByText('Teresa Mamani')).toBeInTheDocument();
    expect(screen.queryByText('Asignar a')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Insistir')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(enviado).toMatchObject({ type: 'CALL', timeMode: 'FIXED', scheduledTime: '09:30', observations: 'Insistir', details: { contactId: 'ct-1' } });
    expect(enviado).not.toHaveProperty('scheduledDate');
    expect(enviado).not.toHaveProperty('creditId');
    expect(enviado).not.toHaveProperty('assigneeId');
  });
});

describe('NewTaskModal · reasignar al editar (F4/11 · E5)', () => {
  const ITEM = {
    id: 'a1', clientId: 'cl-1', creditId: 'cr-dia', assigneeId: 'u9', assigneeName: 'Julia Ticona', createdBy: 'u1',
    type: 'CALL', status: 'SCHEDULED', scheduledDate: '2026-10-07T00:00:00.000Z', timeMode: 'FIXED', scheduledTime: '09:30',
    details: { contactId: 'ct-1' }, isOverdue: false, createdAt: '', updatedAt: '',
  } as never;
  const PEOPLE = [
    { userId: 'u7', firstName: 'Rosa', lastName: 'Aliaga', roleName: 'COLLECTOR', branchId: 'b1' },
    { userId: 'u9', firstName: 'Julia', lastName: 'Ticona', roleName: 'COLLECTOR', branchId: 'b1' },
  ];

  async function edit(assign: { meId: string } | undefined): Promise<Record<string, unknown>[]> {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get('*/api/agenda/context/cl-1', () => HttpResponse.json(CONTEXT)),
      http.get('*/api/agenda/assignees', () => HttpResponse.json({ data: PEOPLE })),
      http.patch('*/api/agenda/a1', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 'a1' });
      }),
    );
    render(
      <ToastProvider>
        <NewTaskModal open onClose={() => {}} date="2026-10-07" editing={ITEM} assign={assign} />
      </ToastProvider>,
    );
    await screen.findByText('Teresa Mamani');
    return bodies;
  }

  it('quien puede asignar ve el responsable actual y, si elige a otra persona, lo manda', async () => {
    const bodies = await edit({ meId: 'u1' });
    const select = (await screen.findAllByRole('combobox')).find((s) => (s as HTMLSelectElement).value === 'u9')!;
    expect(select).toBeTruthy();
    await userEvent.selectOptions(select, 'u7');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ assigneeId: 'u7' });
  });

  it('si no cambia de responsable no manda assigneeId', async () => {
    const bodies = await edit({ meId: 'u1' });
    await screen.findAllByRole('combobox');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty('assigneeId');
  });

  it('sin agenda:assign no hay campo de responsable al editar', async () => {
    await edit(undefined);
    expect(screen.queryByText('Responsable')).toBeNull();
  });
});

// El mapa real (MapLibre) no corre en jsdom: se reemplaza por un botón que «toca» un punto.
vi.mock('@/components/map-picker', () => ({
  MapPicker: ({ onChange }: { onChange?: (p: { latitude: number; longitude: number }) => void }) => (
    <button type="button" onClick={() => onChange?.({ latitude: -16.5, longitude: -68.15 })}>
      tocar el mapa
    </button>
  ),
}));

describe('NewTaskModal · visita a una dirección sin ubicación (F4/11 · D3)', () => {
  const SIN_PUNTO = { ...CONTEXT, locations: [{ id: 'loc-1', locationType: 'HOME', address: 'Av. Importada 12', zone: 'Sur' }] };
  const CON_PUNTO = { ...CONTEXT, locations: [{ id: 'loc-1', locationType: 'HOME', address: 'Av. Importada 12', latitude: -16.4, longitude: -68.1 }] };

  async function abrirVisita(contexto: unknown) {
    server.use(
      http.get('*/api/clients', () => HttpResponse.json({ data: [CLIENT] })),
      http.get('*/api/agenda/context/cl-1', () => HttpResponse.json(contexto)),
    );
    render(
      <ToastProvider>
        <NewTaskModal open onClose={() => {}} date="2026-10-05" />
      </ToastProvider>,
    );
    await userEvent.type(screen.getByRole('textbox'), 'teresa');
    await userEvent.click(await screen.findByRole('button', { name: /Teresa Mamani/ }));
    await userEvent.click(await screen.findByRole('radio', { name: /Visita/ }));
  }

  it('avisa que falta la ubicación y no deja agendar hasta marcarla', async () => {
    await abrirVisita(SIN_PUNTO);
    expect(await screen.findByText(/no tiene ubicación en el mapa/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agendar' })).toBeDisabled();
  });

  it('marcar el punto corrige LA dirección (PATCH, no una nueva) y habilita agendar', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.patch('*/api/agenda/context/cl-1/locations/loc-1', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 'loc-1', locationType: 'HOME', address: 'Av. Importada 12', latitude: -16.5, longitude: -68.15 });
      }),
    );
    await abrirVisita(SIN_PUNTO);
    const guardar = await screen.findByRole('button', { name: 'Guardar ubicación' });
    expect(guardar).toBeDisabled(); // sin tocar el mapa no hay punto que guardar
    await userEvent.click(screen.getByRole('button', { name: 'tocar el mapa' }));
    await userEvent.click(guardar);

    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ address: 'Av. Importada 12', latitude: -16.5, longitude: -68.15 });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Agendar' })).toBeEnabled());
    expect(screen.queryByText(/no tiene ubicación en el mapa/)).toBeNull();
  });

  it('una dirección que ya tiene punto no pide nada y se agenda directo', async () => {
    await abrirVisita(CON_PUNTO);
    expect(screen.queryByText(/no tiene ubicación en el mapa/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Agendar' })).toBeEnabled();
  });
});
