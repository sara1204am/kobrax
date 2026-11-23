import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { LateInterestView } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { LateInterestSection } from './late-interest-section';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const CREDIT = '11111111-1111-4111-8111-111111111111';
const LATE: LateInterestView = {
  asOf: '2026-11-22',
  accrued: 50,
  collected: 10,
  waived: 5,
  pending: 35,
  installments: [{ installmentNumber: 1, dueDate: '2026-11-12', accrued: 50, collected: 10, waived: 5, pending: 35 }],
  policy: { annualRate: 36.5, dayCount: 365, graceDays: 0, capPctOfPrincipal: null },
};

const renderIt = (late: LateInterestView | null | undefined, permissions: string[]) =>
  render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <LateInterestSection creditId={CREDIT} currency="BOB" lateInterest={late} />
      </ToastProvider>
    </PermissionsProvider>,
  );

beforeEach(() => refresh.mockClear());

describe('LateInterestSection — interés moratorio del crédito (F17)', () => {
  it('un crédito que no devenga no dibuja nada', () => {
    renderIt(null, ['payment:read']);
    expect(screen.queryByText('Interés moratorio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('late-interest-summary')).not.toBeInTheDocument();
  });

  it('🔴 sin el permiso de activar no hay botón; con él, un crédito sin mora ofrece activarla', () => {
    renderIt(null, ['payment:read', 'payment:waive_late']);
    expect(screen.queryByRole('button', { name: 'Activar interés moratorio' })).not.toBeInTheDocument();
  });

  it('con el permiso activa: pide fecha y motivo y manda ambos', async () => {
    const sent: unknown[] = [];
    server.use(
      http.post(`*/api/credits/${CREDIT}/late-activation`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ data: { id: 'a1' } }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderIt(null, ['payment:read', 'payment:activate_late']);
    await user.click(screen.getByRole('button', { name: 'Activar interés moratorio' }));
    const confirm = screen.getByRole('button', { name: 'Activar' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Empieza a correr el/), '2027-01-15');
    expect(confirm).toBeDisabled(); // falta el motivo
    await user.type(screen.getByLabelText(/Motivo/), 'Refinanciación acordada');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(sent).toEqual([{ startsOn: '2027-01-15', reason: 'Refinanciación acordada' }]);
    expect(refresh).toHaveBeenCalled();
  });

  it('un crédito activado con inicio futuro avisa desde cuándo corre', () => {
    renderIt({ ...LATE, accrued: 0, collected: 0, waived: 0, pending: 0, installments: [], policy: { ...LATE.policy, startsOn: '2027-01-15' } }, ['payment:read']);
    expect(screen.getByText(/corre desde el/)).toBeInTheDocument();
  });

  it('muestra devengado, cobrado, exonerado y pendiente, aparte del plan', () => {
    renderIt(LATE, ['payment:read']);
    const summary = screen.getByTestId('late-interest-summary');
    expect(summary).toHaveTextContent('Devengado');
    expect(summary).toHaveTextContent('Pendiente');
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('🔴 sin el permiso de exonerar no hay botón (registrar pagos no basta)', () => {
    renderIt(LATE, ['payment:read', 'payment:write']);
    expect(screen.queryByRole('button', { name: 'Exonerar mora' })).not.toBeInTheDocument();
  });

  it('con el permiso exonera: pide motivo, no deja pasar de la mora pendiente y manda la cuota, el monto y el motivo', async () => {
    const sent: unknown[] = [];
    server.use(
      http.post(`*/api/credits/${CREDIT}/late-waivers`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ data: { id: 'w1' } }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderIt(LATE, ['payment:read', 'payment:waive_late']);
    await user.click(screen.getByRole('button', { name: 'Exonerar mora' }));

    const confirm = screen.getByRole('button', { name: 'Exonerar' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Monto a exonerar/), '99');
    expect(screen.getByText(/No puede superar la mora pendiente/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Monto a exonerar/));
    await user.type(screen.getByLabelText(/Monto a exonerar/), '20');
    expect(confirm).toBeDisabled(); // falta el motivo
    await user.type(screen.getByLabelText(/Motivo/), 'Convenio de pago');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(sent).toEqual([{ installmentNumber: 1, amount: 20, reason: 'Convenio de pago' }]);
    expect(refresh).toHaveBeenCalled();
  });
});
