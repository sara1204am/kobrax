import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    // El cuerpo mínimo: el canal por defecto y una nota vacía no viajan. Sí viaja desde dónde se registra.
    expect(sent.body).toEqual({ creditId: 'cr1', amount: 500, method: 'CASH', registeredVia: 'WEB' });
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

describe('PaymentModal — cuota que toca y saldo para liquidar', () => {
  const credit: PaymentCredit = { id: 'cr1', code: 'CR-1', suggestedAmount: 500, balance: 3000, currency: 'BOB' };

  it('muestra las dos cifras y cada una es un atajo al campo', async () => {
    renderModal(credit);
    expect(screen.getByText('Cuota que toca')).toBeInTheDocument();
    expect(screen.getByText('Saldo para liquidar')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Saldo para liquidar/ }));
    expect(screen.getByLabelText('Monto')).toHaveValue('3000');
    await userEvent.click(screen.getByRole('button', { name: /Cuota que toca/ }));
    expect(screen.getByLabelText('Monto')).toHaveValue('500');
  });

  it('🔴 no deja pagar más de lo que se debe', async () => {
    renderModal(credit);
    const monto = screen.getByLabelText('Monto');
    await userEvent.clear(monto);
    await userEvent.type(monto, '3000.01');

    expect(screen.getByRole('alert')).toHaveTextContent(/No puede pagar más de lo que debe/);
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeDisabled();

    // Liquidar exacto sí se puede.
    await userEvent.clear(monto);
    await userEvent.type(monto, '3000');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeEnabled();
  });

  it('un crédito PSF no se topa: su saldo es el del último reporte y puede ir atrasado', async () => {
    renderModal({ ...credit, external: true });
    const monto = screen.getByLabelText('Monto');
    await userEvent.clear(monto);
    await userEvent.type(monto, '9999');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeEnabled();
  });
});

describe('PaymentModal — sin crédito: primero la persona, después el préstamo', () => {
  function renderPicker() {
    render(
      <ToastProvider>
        <PaymentModal open onClose={vi.fn()} />
      </ToastProvider>,
    );
  }

  it('busca al deudor, lista sus créditos pagables y arranca con la cuota y el saldo', async () => {
    const sent = capture();
    server.use(
      http.get('*/api/clients', () =>
        HttpResponse.json({ data: [{ id: 'cl1', firstName: 'Teresa', lastName: 'Mamani', nationalId: '***123' }] }),
      ),
      http.get('*/api/credits', () =>
        HttpResponse.json({
          data: [
            { id: 'cr1', code: 'CR-1', status: 'ACTIVE', outstandingBalance: 3000, currency: 'BOB', daysPastDue: 12 },
            // Un crédito ya pagado no se ofrece: la API lo rechazaría.
            { id: 'cr2', code: 'CR-2', status: 'PAID', outstandingBalance: 0, currency: 'BOB', daysPastDue: 0 },
          ],
        }),
      ),
      // El detalle trae el cronograma: de ahí sale la cuota que toca.
      http.get('*/api/credits/cr1', () =>
        HttpResponse.json({ data: { id: 'cr1', code: 'CR-1', status: 'ACTIVE', outstandingBalance: 3000, currency: 'BOB', suggestedPaymentAmount: 450 } }),
      ),
    );
    renderPicker();

    await userEvent.type(screen.getByLabelText('Buscar al deudor'), 'Teresa');
    await userEvent.click(await screen.findByRole('button', { name: /Teresa Mamani/ }));

    expect(await screen.findByRole('button', { name: /CR-1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CR-2/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /CR-1/ }));

    const monto = await screen.findByLabelText('Monto');
    expect(monto).toHaveValue('450');
    expect(screen.getByText('Saldo para liquidar')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(sent.body).toEqual({ creditId: 'cr1', amount: 450, method: 'CASH', registeredVia: 'WEB' }));
  });
});

describe('PaymentModal — N° de recibo o factura', () => {
  it('es opcional: sin escribirlo el cuerpo no lo lleva', async () => {
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 100 });
    expect(screen.getByLabelText('N° de recibo o factura (opcional)')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).not.toHaveProperty('receiptReference');
  });

  it('viaja tal cual se escribió, sin los espacios de los extremos', async () => {
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 100 });
    await userEvent.type(screen.getByLabelText('N° de recibo o factura (opcional)'), '  R-004512 ');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).toMatchObject({ receiptReference: 'R-004512' });
  });
});

describe('PaymentModal — foto del comprobante', () => {
  const HASH = 'a'.repeat(64);
  const photo = () => new File([new Uint8Array([1, 2, 3])], 'recibo.jpg', { type: 'image/jpeg' });

  function mockUpload(ok = true) {
    const uploaded: { count: number } = { count: 0 };
    server.use(
      http.post('*/api/account/upload', () => {
        uploaded.count += 1;
        return ok
          ? HttpResponse.json({ url: '/api/uploads/abc123.jpg', hash: HASH, size: 3, mimeType: 'image/jpeg' })
          : HttpResponse.json({ error: { code: 'UPLOAD', message: 'La imagen es muy grande' } }, { status: 413 });
      }),
    );
    return uploaded;
  }

  it('es opcional: sin foto el cuerpo no lleva comprobante', async () => {
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 100 });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).not.toHaveProperty('receiptUrl');
    expect(sent.body).not.toHaveProperty('receiptHash');
  });

  it('sube la foto al elegirla y viaja con el pago como ruta interna + hash', async () => {
    const uploaded = mockUpload();
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 100 });

    // El selector de archivos va oculto: el botón lo abre, y en el celular ofrece la cámara.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/*');
    await userEvent.upload(input, photo());

    expect(await screen.findByText('recibo.jpg')).toBeInTheDocument();
    expect(uploaded.count).toBe(1);
    expect(screen.getByRole('button', { name: 'Cambiar la foto' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).toMatchObject({ receiptUrl: '/api/uploads/abc123.jpg', receiptHash: HASH });
  });

  it('se puede quitar la foto antes de confirmar: entonces no viaja', async () => {
    mockUpload();
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 100 });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, photo());
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar' }));
    expect(screen.queryByText('recibo.jpg')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).not.toHaveProperty('receiptUrl');
  });

  it('si la subida falla lo dice y el pago se puede registrar igual, sin foto', async () => {
    mockUpload(false);
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 100 });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, photo());

    expect(await screen.findByText('La imagen es muy grande')).toBeInTheDocument();
    expect(screen.queryByText('recibo.jpg')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).not.toHaveProperty('receiptUrl');
  });
});

const isoDay = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('PaymentModal — la fecha del pago', () => {
  it('🔴 el PRIMER campo es la fecha: hoy preseleccionado, sin días futuros y hasta 29 días atrás', () => {
    renderModal({ id: 'cr1', code: '302-222-2542', suggestedAmount: 500 });
    const date = screen.getByLabelText(/Fecha del pago/) as HTMLInputElement;
    expect(date).toHaveAttribute('type', 'date');
    expect(date.value).toBe(isoDay(0));
    expect(date).toHaveAttribute('max', isoDay(0));
    expect(date).toHaveAttribute('min', isoDay(-29));
    // Va antes que el crédito y el monto.
    for (const later of [screen.getByLabelText('Crédito'), screen.getByLabelText('Monto')]) {
      expect(date.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('sin tocar la fecha el pago es de ahora: no manda `paymentDate`', async () => {
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 500 });
    await userEvent.type(screen.getByLabelText('Monto'), '{Enter}');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.body).not.toHaveProperty('paymentDate');
  });

  it('🔴 un pago de un día anterior viaja con ESE día (al mediodía, para que ninguna zona lo corra)', async () => {
    const sent = capture();
    const { onClose } = renderModal({ id: 'cr1', suggestedAmount: 500 });
    fireEvent.change(screen.getByLabelText(/Fecha del pago/), { target: { value: isoDay(-4) } });
    await userEvent.type(screen.getByLabelText('Monto'), '{Enter}');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    const sentDate = new Date(sent.body!.paymentDate as string);
    expect(sentDate.getTime()).toBe(new Date(`${isoDay(-4)}T12:00:00`).getTime());
    expect(sent.body).toMatchObject({ creditId: 'cr1', amount: 500 });
  });

  it('🔴 una fecha futura, una demasiado vieja o vacía no se pueden registrar', async () => {
    const sent = capture();
    renderModal({ id: 'cr1', suggestedAmount: 500 });
    const confirm = screen.getByRole('button', { name: 'Registrar' });
    for (const bad of [isoDay(1), isoDay(-45), '']) {
      fireEvent.change(screen.getByLabelText(/Fecha del pago/), { target: { value: bad } });
      expect(confirm).toBeDisabled();
      expect(screen.getByText(/no se registran pagos futuros ni más viejos/)).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText(/Fecha del pago/), { target: { value: isoDay(-29) } });
    expect(confirm).toBeEnabled();
    expect(sent.body).toBeUndefined();
  });
});

