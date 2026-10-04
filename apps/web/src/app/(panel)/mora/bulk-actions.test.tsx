import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActions } from './bulk-actions';

const { refresh, toast, post } = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));
vi.mock('@/lib/client', async (orig) => ({ ...(await orig<typeof import('@/lib/client')>()), postJson: post }));

const COLLECTORS = [
  { userId: 'u1', name: 'Carlos Mamani' },
  { userId: 'u2', name: 'Lucía Rojas' },
];

function renderBulk(props: Partial<React.ComponentProps<typeof BulkActions>> = {}) {
  const clear = vi.fn();
  render(<BulkActions ids={['cr1', 'cr2']} clear={clear} collectors={COLLECTORS} canAssign canWrite {...props} />);
  return clear;
}

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  post.mockReset();
});

describe('BulkActions — por créditos', () => {
  it('asignar: hay que elegir al cobrador (no existe «al de menor carga») y viaja userId con los creditIds', async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { done: 2, failed: 0 } });
    const clear = renderBulk();
    await userEvent.click(screen.getByRole('button', { name: 'Asignar a un cobrador' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Asignar a un cobrador' });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Responsable'), 'u2');
    await userEvent.click(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/mora/bulk', { creditIds: ['cr1', 'cr2'], action: 'assign', userId: 'u2' }));
    expect(toast).toHaveBeenCalledWith('Listo: 2 préstamos');
    expect(clear).toHaveBeenCalled();
  });

  it('🔴 un lote parcial dice cuántos entraron, cuántos no y el motivo traducido', async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { done: 1, failed: 1, message: 'OUT_OF_AGENCY' } });
    const clear = renderBulk();
    await userEvent.click(screen.getByRole('button', { name: 'Asignar a un cobrador' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Responsable'), 'u1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Asignar a un cobrador' }));
    expect((await screen.findAllByText('Entraron 1 y fallaron 1. Está fuera de tu agencia.')).length).toBeGreaterThan(0);
    expect(clear).not.toHaveBeenCalled();
  });

  it('la prioridad se manda por créditos; «volver a la automática» viaja como auto', async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { done: 2, failed: 0 } });
    renderBulk();
    await userEvent.click(screen.getByRole('button', { name: 'Prioridad' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Prioridad'), 'auto');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cambiar prioridad' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/mora/bulk', { creditIds: ['cr1', 'cr2'], action: 'priority', priority: 'auto' }));
  });

  it('poner al día manda el modo elegido sobre los créditos', async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { done: 2, failed: 0 } });
    renderBulk();
    await userEvent.click(screen.getByRole('button', { name: 'Poner al día' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/su mora se cierra/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Poner al día' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/mora/bulk', { creditIds: ['cr1', 'cr2'], action: 'clear', mode: 'next_period' }));
  });

  it('sin assignment:write no hay «Asignar»; sin collection:write no hay «Prioridad»', () => {
    renderBulk({ canAssign: false, canWrite: false });
    expect(screen.queryByRole('button', { name: 'Asignar a un cobrador' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prioridad' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Poner al día' })).toBeInTheDocument();
  });
});
