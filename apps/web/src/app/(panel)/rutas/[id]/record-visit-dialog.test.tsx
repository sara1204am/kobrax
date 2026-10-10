import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { RecordVisitDialog, type RecordStop } from './record-visit-dialog';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const STOP: RecordStop = {
  id: 's1',
  creditId: 'cr1',
  clientName: 'Teresa Aguilar',
  address: 'Calle 12 de Calacoto #890',
  latitude: -16.54,
  longitude: -68.08,
  overdueAmount: 500,
  currency: 'BOB',
};

interface Calls {
  visit: Record<string, unknown>[];
  evidence: Record<string, unknown>[];
  payment: { body: Record<string, unknown>; key: string | null }[];
  agenda: Record<string, unknown>[];
}

function mockApi(over: { visitError?: boolean; payError?: boolean } = {}): Calls {
  const calls: Calls = { visit: [], evidence: [], payment: [], agenda: [] };
  server.use(
    http.get('*/api/catalogs/PAYMENT_METHOD', () => HttpResponse.json({ data: [{ code: 'CASH', label: 'Efectivo' }] })),
    http.get('*/api/catalogs/SPECIAL_CATEGORY', () => HttpResponse.json({ data: [{ code: 'DECEASED', label: 'Fallecimiento' }] })),
    http.post('*/api/visits', async ({ request }) => {
      calls.visit.push((await request.json()) as Record<string, unknown>);
      if (over.visitError) return HttpResponse.json({ error: { code: 'VISIT_STOP_DONE', message: 'Esta parada ya tiene su visita.' } }, { status: 409 });
      return HttpResponse.json({ id: 'v1' }, { status: 201 });
    }),
    http.post('*/api/visits/:id/evidence', async ({ request }) => {
      calls.evidence.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 'e1' });
    }),
    http.post('*/api/payments', async ({ request }) => {
      calls.payment.push({ body: (await request.json()) as Record<string, unknown>, key: request.headers.get('idempotency-key') });
      if (over.payError) return HttpResponse.json({ error: { message: 'No' } }, { status: 400 });
      return HttpResponse.json({ id: 'p1' }, { status: 201 });
    }),
    http.post('*/api/agenda', async ({ request }) => {
      calls.agenda.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 'a1' }, { status: 201 });
    }),
    http.post('*/api/account/upload', () => HttpResponse.json({ url: '/api/uploads/x.jpg', hash: 'a'.repeat(64), size: 10, mimeType: 'image/jpeg' })),
  );
  return calls;
}

function setup(over: Partial<Parameters<typeof RecordVisitDialog>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <RecordVisitDialog open onClose={onClose} stop={STOP} collectorName="Carlos Collector" viewerIsCollector={false} canPay today="2026-10-08" {...over} />,
  );
  return { onClose, dialog: screen.getByRole('dialog', { hidden: true }) };
}

const choose = (name: string) => userEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
const submit = (label = 'Registrar gestión') => userEvent.click(screen.getByRole('button', { name: label }));

beforeEach(() => refresh.mockClear());

describe('RecordVisitDialog · registrar una gestión desde el panel (F4/12 · decisión 2)', () => {
  it('muestra las 6 variantes del móvil y no deja guardar sin elegir una', () => {
    mockApi();
    setup();
    for (const v of ['Cobrado', 'Promesa de pago', 'No contesta', 'Visita sin contacto', 'Dirección incorrecta', 'Gestión especial']) {
      expect(screen.getByRole('button', { name: new RegExp(v) })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Registrar gestión' })).toBeDisabled();
  });

  it('🔴 quien la carga a nombre de otro lo ve dicho, y el cobrador que la carga él mismo no', () => {
    mockApi();
    setup();
    expect(screen.getByText(/a nombre de Carlos Collector/)).toBeInTheDocument();
  });

  it('el cobrador de la ruta no ve el aviso de «a nombre de»', () => {
    mockApi();
    setup({ viewerIsCollector: true });
    expect(screen.queryByText(/a nombre de/)).toBeNull();
  });

  it('«No contesta» + «Volver a visitar»: agenda una visita nueva para el día y la franja elegidos', async () => {
    const calls = mockApi();
    setup({ stop: { ...STOP, locationId: 'loc1' } });
    await choose('No contesta');
    await userEvent.click(screen.getByLabelText('Volver a visitar'));
    await userEvent.selectOptions(screen.getByLabelText('¿Cuándo?'), 'AFTERNOON');
    fireEvent.change(screen.getByLabelText('¿Qué día?'), { target: { value: '2026-10-10' } });
    await submit();
    await vi.waitFor(() => expect(calls.agenda).toHaveLength(1));
    expect(calls.agenda[0]).toMatchObject({
      creditId: 'cr1',
      type: 'VISIT',
      scheduledDate: '2026-10-10',
      timeMode: 'LAPSE',
      timeSlot: 'AFTERNOON',
      details: { locationId: 'loc1' },
    });
  });

  it('«Volver a visitar» solo se ofrece cuando no se encontró a nadie', async () => {
    mockApi();
    setup();
    await choose('Cobrado');
    expect(screen.queryByLabelText('Volver a visitar')).toBeNull();
    await choose('Visita sin contacto');
    expect(screen.getByLabelText('Volver a visitar')).toBeInTheDocument();
  });

  it('«No contesta»: manda la visita con el punto conocido de la parada, marcada como panel y estimada', async () => {
    const calls = mockApi();
    const { onClose } = setup();
    await choose('No contesta');
    await submit();
    await vi.waitFor(() => expect(calls.visit).toHaveLength(1));
    expect(calls.visit[0]).toMatchObject({
      routeStopId: 's1',
      creditId: 'cr1',
      lat: -16.54,
      lng: -68.08,
      gpsFallback: true,
      source: 'WEB',
      outcome: 'NO_CONTACT',
      details: { channel: 'CALL' },
    });
    expect(calls.visit[0]!.id).toEqual(expect.any(String));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('«Cobrado»: el monto no puede pasar el saldo del crédito', async () => {
    mockApi();
    setup();
    await choose('Cobrado');
    await userEvent.type(screen.getByLabelText('Monto cobrado'), '600');
    expect(screen.getByRole('button', { name: 'Registrar gestión' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Monto cobrado'));
    await userEvent.type(screen.getByLabelText('Monto cobrado'), '500');
    expect(screen.getByRole('button', { name: 'Registrar gestión' })).toBeEnabled();
    expect(screen.getByText(/Hasta Bs\s*500/)).toBeInTheDocument();
  });

  it('🔴 un cobro parcial queda como PARTIAL_PAYMENT y el pago viaja LIGADO a la visita, con clave de idempotencia', async () => {
    const calls = mockApi();
    setup();
    await choose('Cobrado');
    await userEvent.type(screen.getByLabelText('Monto cobrado'), '200');
    await submit();
    await vi.waitFor(() => expect(calls.payment).toHaveLength(1));
    expect(calls.visit[0]!.outcome).toBe('PARTIAL_PAYMENT');
    expect(calls.payment[0]!.body).toMatchObject({ creditId: 'cr1', amount: 200, method: 'CASH', visitId: calls.visit[0]!.id });
    // Reintentar con el mismo id no cobra dos veces: la clave sale de la visita.
    expect(calls.payment[0]!.key).toBe(`visit-${calls.visit[0]!.id}`);
  });

  it('cubrir el saldo entero es PAID', async () => {
    const calls = mockApi();
    setup();
    await choose('Cobrado');
    await userEvent.type(screen.getByLabelText('Monto cobrado'), '500');
    await submit();
    await vi.waitFor(() => expect(calls.visit).toHaveLength(1));
    expect(calls.visit[0]!.outcome).toBe('PAID');
  });

  it('sin permiso de pagos el cobro no se puede elegir, y dice por qué', () => {
    mockApi();
    setup({ canPay: false });
    expect(screen.getByRole('button', { name: /Cobrado/ })).toBeDisabled();
    expect(screen.getAllByText(/permiso de pagos/).length).toBeGreaterThan(0);
  });

  it('«Promesa de pago»: registra la visita y crea la promesa en la agenda con su fecha y monto', async () => {
    const calls = mockApi();
    setup();
    await choose('Promesa de pago');
    await userEvent.type(screen.getByLabelText('Monto prometido'), '300');
    await submit();
    await vi.waitFor(() => expect(calls.agenda).toHaveLength(1));
    expect(calls.visit[0]!.outcome).toBe('PROMISE_TO_PAY');
    expect(calls.agenda[0]).toMatchObject({ creditId: 'cr1', type: 'PROMISE_TO_PAY', scheduledDate: '2026-10-08', details: { amount: 300, promiseDate: '2026-10-08' } });
  });

  it('«Dirección incorrecta» exige explicar qué pasó', async () => {
    mockApi();
    setup();
    await choose('Dirección incorrecta');
    expect(screen.getByRole('button', { name: 'Registrar gestión' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Qué pasó con la dirección/), 'La calle no existe');
    expect(screen.getByRole('button', { name: 'Registrar gestión' })).toBeEnabled();
  });

  it('«Gestión especial» exige la categoría del catálogo', async () => {
    const calls = mockApi();
    setup();
    await choose('Gestión especial');
    const select = await screen.findByLabelText('Categoría de la gestión especial');
    expect(screen.getByRole('button', { name: 'Registrar gestión' })).toBeDisabled();
    await userEvent.selectOptions(select, 'DECEASED');
    await submit();
    await vi.waitFor(() => expect(calls.visit).toHaveLength(1));
    expect(calls.visit[0]).toMatchObject({ outcome: 'SPECIAL', details: { categoryCode: 'DECEASED' } });
  });

  it('adjunta la foto a la visita ya registrada, con su huella', async () => {
    const calls = mockApi();
    setup();
    await choose('No contesta');
    const file = new File(['x'], 'puerta.jpg', { type: 'image/jpeg' });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(await screen.findByText('puerta.jpg')).toBeInTheDocument();
    await submit();
    await vi.waitFor(() => expect(calls.evidence).toHaveLength(1));
    expect(calls.evidence[0]).toEqual({ type: 'PHOTO', fileUrl: '/api/uploads/x.jpg', fileHash: 'a'.repeat(64) });
  });

  it('🔴 si la visita no se pudo registrar, se muestra el motivo y NO se intenta el cobro', async () => {
    const calls = mockApi({ visitError: true });
    const { onClose } = setup();
    await choose('Cobrado');
    await userEvent.type(screen.getByLabelText('Monto cobrado'), '100');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta parada ya tiene su visita.');
    expect(calls.payment).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('🔴 si la visita se registró pero el cobro falló, se dice cuál: no se cierra como si nada', async () => {
    mockApi({ payError: true });
    const { onClose } = setup();
    await choose('Cobrado');
    await userEvent.type(screen.getByLabelText('Monto cobrado'), '100');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/quedó registrada, pero no se pudo registrar el cobro/);
    expect(onClose).not.toHaveBeenCalled();
    // Con la visita ya registrada la única salida es «Cerrar»: no hay nada que reintentar a ciegas.
    expect(screen.queryByRole('button', { name: 'Registrar gestión' })).toBeNull();
  });

  it('una corrección manda la visita que corrige y lo explica', async () => {
    const calls = mockApi();
    setup({ correctsVisitId: 'v-vieja' });
    expect(screen.getByText(/no se edita: esto guarda una nueva/)).toBeInTheDocument();
    await choose('No contesta');
    await submit('Guardar la corrección');
    await vi.waitFor(() => expect(calls.visit).toHaveLength(1));
    expect(calls.visit[0]!.correctsVisitId).toBe('v-vieja');
  });
});

describe('RecordVisitDialog · parada sin ubicación', () => {
  it('sin punto conocido se manda (0, 0) marcado como estimado: la API lo exige, y el panel no dibuja ese punto', async () => {
    const calls = mockApi();
    setup({ stop: { ...STOP, latitude: undefined, longitude: undefined } });
    await choose('No contesta');
    await submit();
    await vi.waitFor(() => expect(calls.visit).toHaveLength(1));
    expect(calls.visit[0]).toMatchObject({ lat: 0, lng: 0, gpsFallback: true });
  });
});


describe('RecordVisitDialog · la cuota que correspondía pagar', () => {
  const CON_CUOTA: RecordStop = { ...STOP, installmentAmount: 450, nextDueDate: '2026-10-07' };

  it('con dato de la cuota, la muestra bajo el monto cobrado —con su vencimiento— y antes del tope', async () => {
    mockApi();
    setup({ stop: CON_CUOTA });
    await choose('Cobrado');
    expect(screen.getByText(/Cuota a pagar: .*450/)).toBeInTheDocument();
    expect(screen.getByText(/vence/)).toBeInTheDocument();
    const cuota = screen.getByText(/Cuota a pagar/);
    const tope = screen.getByText(/Hasta/);
    // La cuota va antes que «Hasta el total».
    expect(cuota.compareDocumentPosition(tope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('«Usar este monto» llena el campo con la cuota', async () => {
    mockApi();
    setup({ stop: CON_CUOTA });
    await choose('Cobrado');
    await userEvent.click(screen.getByRole('button', { name: 'Usar este monto' }));
    expect(screen.getByLabelText('Monto cobrado')).toHaveValue('450');
    // Ya está puesto: el botón sobra.
    expect(screen.queryByRole('button', { name: 'Usar este monto' })).toBeNull();
  });

  it('🔴 sin dato de la cuota no se muestra nada: nunca «Cuota a pagar: Bs 0»', async () => {
    mockApi();
    setup({ stop: STOP });
    await choose('Cobrado');
    expect(screen.queryByText(/Cuota a pagar/)).toBeNull();
    expect(screen.getByText(/Hasta/)).toBeInTheDocument();
  });
});
