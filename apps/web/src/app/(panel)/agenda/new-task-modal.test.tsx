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
