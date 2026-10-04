import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WriteOffButton } from './write-off-button';

const { refresh, toast, send } = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), send: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));
vi.mock('@/lib/client', async (orig) => ({ ...(await orig<typeof import('@/lib/client')>()), sendJson: send }));

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  send.mockReset();
});

/** El botón de confirmar del modal es el último con ese nombre (el primero abre el modal). */
const last = (name: string) => screen.getAllByRole('button', { name }).at(-1)!;

describe('WriteOffButton', () => {
  it('🔴 sin credit:write con alcance total (canWriteOff=false) no se dibuja nada', () => {
    const { container } = render(<WriteOffButton creditId="c1" writtenOff={false} canWriteOff={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('con permiso se ofrece «Castigar»; si ya está castigado, «Revertir castigo»', () => {
    const { rerender } = render(<WriteOffButton creditId="c1" writtenOff={false} canWriteOff />);
    expect(screen.getByRole('button', { name: 'Castigar' })).toBeInTheDocument();
    rerender(<WriteOffButton creditId="c1" writtenOff canWriteOff />);
    expect(screen.getByRole('button', { name: 'Revertir castigo' })).toBeInTheDocument();
  });

  it('castigar: pide un motivo opcional y manda POST con él', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {} });
    render(<WriteOffButton creditId="c1" writtenOff={false} canWriteOff />);
    await userEvent.click(screen.getByRole('button', { name: 'Castigar' }));
    await userEvent.type(screen.getByLabelText('Motivo (opcional)'), ' Incobrable ');
    await userEvent.click(last('Castigar'));
    await waitFor(() => expect(send).toHaveBeenCalledWith('/api/credits/c1/write-off', { reason: 'Incobrable' }, 'POST'));
    expect(toast).toHaveBeenCalledWith('Crédito castigado');
    expect(refresh).toHaveBeenCalled();
  });

  it('el motivo es opcional: sin él manda el cuerpo vacío', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {} });
    render(<WriteOffButton creditId="c1" writtenOff={false} canWriteOff />);
    await userEvent.click(screen.getByRole('button', { name: 'Castigar' }));
    await userEvent.click(last('Castigar'));
    await waitFor(() => expect(send).toHaveBeenCalledWith('/api/credits/c1/write-off', {}, 'POST'));
  });

  it('revertir manda DELETE y no pide motivo', async () => {
    send.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<WriteOffButton creditId="c1" writtenOff canWriteOff />);
    await userEvent.click(screen.getByRole('button', { name: 'Revertir castigo' }));
    expect(screen.queryByLabelText('Motivo (opcional)')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Revertir' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('/api/credits/c1/write-off', {}, 'DELETE'));
    expect(toast).toHaveBeenCalledWith('Castigo revertido');
  });

  it('un error de la API se muestra y no refresca', async () => {
    send.mockResolvedValue({ ok: false, status: 403, data: { error: { code: 'X', message: 'No tenés permiso' } } });
    render(<WriteOffButton creditId="c1" writtenOff={false} canWriteOff />);
    await userEvent.click(screen.getByRole('button', { name: 'Castigar' }));
    await userEvent.click(last('Castigar'));
    expect(await screen.findByText('No tenés permiso')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
