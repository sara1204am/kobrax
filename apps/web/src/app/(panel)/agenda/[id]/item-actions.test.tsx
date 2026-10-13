import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('ItemActions · completar con motivo y plantilla (F4/13 · E4/E5)', () => {
  const NO_PAY = [
    { code: 'LATE_PAY', label: 'Le pagan tarde', metadata: { asksExpectedIncomeDate: true } },
    { code: 'NO_MONEY', label: 'No tiene dinero', metadata: {} },
  ];
  const TEMPLATES = [{ code: 'REMINDER_SOFT', label: 'Recordatorio amable' }];

  /** Abre «Registrar la ejecución», elige el desenlace y devuelve el diálogo y lo que viaje a la API. */
  async function openComplete() {
    let enviado: Record<string, unknown> | null = null;
    server.use(
      http.post('*/api/agenda/a1/complete', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 'a1' } });
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Registrar la ejecución' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Qué pasó'), 'CONTACTED');
    return { dialog, sent: () => enviado };
  }

  it('con motivo, fecha esperada y quién responde: el cierre viaja con el contexto', async () => {
    renderActions({ type: 'CALL' as never, reasons: NO_PAY });
    const { dialog, sent } = await openComplete();
    await userEvent.selectOptions(within(dialog).getByLabelText('Motivo de no pago'), 'LATE_PAY');
    fireEvent.change(within(dialog).getByLabelText('Cuándo espera cobrar'), { target: { value: '2026-10-20' } });
    await userEvent.selectOptions(within(dialog).getByLabelText('Quién responde por el crédito'), 'CODEBTOR');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(sent()).not.toBeNull());
    expect(sent()).toMatchObject({ outcome: 'CONTACTED', reasonCode: 'LATE_PAY', expectedIncomeDate: '2026-10-20', payerParty: 'CODEBTOR' });
  });

  it('sin elegir nada, el cierre sale como siempre: sin campos de contexto', async () => {
    renderActions({ type: 'CALL' as never, reasons: NO_PAY });
    const { dialog, sent } = await openComplete();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(sent()).not.toBeNull());
    for (const k of ['reasonCode', 'expectedIncomeDate', 'payerParty', 'templateCode']) expect(sent()).not.toHaveProperty(k);
  });

  it('una promesa o un recordatorio dejan una nota: no ofrecen el motivo', async () => {
    renderActions({ type: 'PROMISE_TO_PAY' as never, reasons: NO_PAY });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar la ejecución' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Motivo de no pago')).toBeNull();
  });

  it('en un WhatsApp ofrece la plantilla usada y manda su código', async () => {
    renderActions({ type: 'WHATSAPP' as never, reasons: NO_PAY, templates: TEMPLATES });
    const { dialog, sent } = await openComplete();
    await userEvent.selectOptions(within(dialog).getByLabelText('Plantilla usada (opcional)'), 'REMINDER_SOFT');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await vi.waitFor(() => expect(sent()).not.toBeNull());
    expect(sent()).toMatchObject({ outcome: 'CONTACTED', templateCode: 'REMINDER_SOFT' });
  });

  it('una llamada no ofrece plantilla aunque la cuenta tenga', async () => {
    renderActions({ type: 'CALL' as never, templates: TEMPLATES });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar la ejecución' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Plantilla usada (opcional)')).toBeNull();
  });
});
