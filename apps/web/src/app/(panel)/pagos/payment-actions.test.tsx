import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { PaymentModal, type PaymentCredit } from './payment-actions';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

function renderModal(credit: PaymentCredit, onClose = vi.fn()) {
  render(
    <ToastProvider>
      <PaymentModal open onClose={onClose} credit={credit} />
    </ToastProvider>,
  );
  return { onClose };
}

/** Lo que llegó al BFF: cuerpo y la clave de idempotencia del header. */
function capture() {
  const sent: { body?: Record<string, unknown>; key?: string | null } = {};
  server.use(
    http.post('*/api/payments', async ({ request }) => {
      sent.body = (await request.json()) as Record<string, unknown>;
      sent.key = request.headers.get('idempotency-key');
      return HttpResponse.json({ id: 'pay1', creditId: 'cr1', amount: 500, method: 'CASH', paymentDate: '2026-09-30' });
    }),
  );
  return sent;
}

beforeEach(() => refresh.mockClear());

describe('PaymentModal — monto → confirmar (§5)', () => {
  it('arranca con el monto sugerido y Enter confirma', async () => {
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', code: '302-222-2542', suggestedAmount: 500 });
    const monto = screen.getByLabelText('Monto');
    expect(monto).toHaveValue('500');
    await userEvent.type(monto, '{Enter}');

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    // El cuerpo mínimo: el canal por defecto y una nota vacía no viajan.
    expect(sent.body).toEqual({ creditId: 'cr1', amount: 500, method: 'CASH' });
    expect(sent.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(refresh).toHaveBeenCalled();
  });

  it('sin monto sugerido arranca vacío y no deja confirmar', () => {
    renderModal({ id: 'cr1' });
    expect(screen.getByLabelText('Monto')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeDisabled();
  });

  it('medio, canal y nota van plegados en «Más opciones» y viajan si se cambian', async () => {
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 100 });
    expect(screen.queryByLabelText('¿Quién recibió la plata?')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
    await userEvent.selectOptions(screen.getByLabelText('¿Quién recibió la plata?'), 'EXTERNAL_CONFIRMED');
    await userEvent.type(screen.getByLabelText('Nota (opcional)'), 'Pagó en ventanilla');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).toMatchObject({ channel: 'EXTERNAL_CONFIRMED', notes: 'Pagó en ventanilla' });
  });

  it('en un crédito PSF avisa que el pago no cambia el saldo reportado', () => {
    renderModal({ id: 'cr1', suggestedAmount: 500, external: true });
    expect(screen.getByText(/no cambia el saldo ni la mora reportados/)).toBeInTheDocument();
  });
});
