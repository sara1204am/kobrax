import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import type { CreditDetail, CreditPaymentsView, UpdatedPlan } from '@kobrax/shared';
import { PermissionsProvider } from '@/components/permissions';
import { CreditSync, notifyCreditChanged } from '@/components/credit-sync';
import { CreditView } from './credit-view';
import { CreditPaymentHistory } from './pagos/credit-payment-history';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

/** El plan de la auditoría tras dos pagos de 3.000: cuota 1 pagada, cuota 2 parcial, al día. */
const PLAN: UpdatedPlan = {
  rows: [
    { number: 1, dueDate: '2026-11-19', amount: 5208.33, paid: 5208.33, pending: 0, status: 'PAID', prepaid: false },
    { number: 2, dueDate: '2026-12-19', amount: 5208.33, paid: 791.67, pending: 4416.66, status: 'PARTIAL', prepaid: false },
    { number: 3, dueDate: '2027-01-19', amount: 5208.33, paid: 0, pending: 5208.33, status: 'PENDING', prepaid: false },
  ],
  planTotal: 15624.99,
  prepaidAmount: 0,
  collectedAmount: 6000,
  unappliedAmount: 0,
  balance: 9624.99,
  overdueAmount: 0,
  overdueCount: 0,
  nextPayment: { number: 2, dueDate: '2026-12-19', amount: 4416.66, overdue: false },
  situation: 'CURRENT',
  baseDaysPastDue: 0,
  payments: [],
};

function credit(over: Partial<CreditDetail> = {}): CreditDetail {
  return {
    id: 'cr-1',
    code: 'CR-000001',
    clientId: 'cl-1',
    principalAmount: 120000,
    outstandingBalance: 119000,
    interestRate: 0,
    currency: 'BOB',
    status: 'ACTIVE',
    daysPastDue: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    labels: {},
    ...over,
  } as CreditDetail;
}

const draw = (c: CreditDetail) =>
  render(
    <PermissionsProvider permissions={['credit:read']}>
      <CreditView credit={c} team={[]} types={[]} />
    </PermissionsProvider>,
  );

describe('Cartera · el plan actualizado', () => {
  it('con plan: muestra las cuotas con lo pagado y el próximo pago con su monto, y deja el original plegado', () => {
    draw(credit({ plan: PLAN }));
    const table = within(screen.getByTestId('updated-plan'));
    const rows = table.getAllByRole('row');
    // cabecera + 3 cuotas
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('Pagada')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Parcial')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/791,67/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/4\.416,66/)).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('Próximo pago')).toBeInTheDocument();
    expect(screen.getByText(/4\.416,66\s·\s/)).toBeInTheDocument();
    expect(screen.getByText('Plan original')).toBeInTheDocument();
  });

  it('sin plan (préstamo abierto, o fuente externa) no inventa uno: sigue el de siempre', () => {
    draw(credit());
    expect(screen.queryByTestId('updated-plan')).toBeNull();
    expect(screen.getByText('Próximo cobro')).toBeInTheDocument();
  });

  it('en mora: muestra lo vencido', () => {
    const overdue: UpdatedPlan = {
      ...PLAN,
      rows: PLAN.rows.map((r, i) => (i === 0 ? { ...r, paid: 3000, pending: 2208.33, status: 'OVERDUE' as const } : r)),
      overdueAmount: 2208.33,
      overdueCount: 1,
      situation: 'OVERDUE',
      nextPayment: { number: 1, dueDate: '2026-11-19', amount: 2208.33, overdue: true },
    };
    draw(credit({ plan: overdue, daysPastDue: 1 }));
    expect(screen.getByText('Vencido')).toBeInTheDocument();
    expect(within(screen.getAllByRole('row')[1]!).getByText('Vencida')).toBeInTheDocument();
  });
});

const VIEW: CreditPaymentsView = {
  creditId: 'cr-1',
  code: 'CR-000001',
  clientId: 'cl-1',
  currency: 'BOB',
  plan: { planTotal: 125000, prepaidAmount: 0, collectedAmount: 6000, balance: 119000, overdueAmount: 0, situation: 'CURRENT', nextPayment: { number: 2, dueDate: '2026-12-19', amount: 4416.66, overdue: false } },
  payments: [
    {
      id: 'p2', creditId: 'cr-1', amount: 3000, method: 'CASH', channel: 'KOBRAX_COLLECTED', paymentDate: '2026-11-20T21:26:00Z', createdAt: '2026-11-20T21:26:00Z', registeredAt: '2026-11-20T21:26:00Z', status: 'REGISTERED',
      imputation: { allocations: [{ installmentNumber: 1, amount: 2208.33, coversInstallment: true }, { installmentNumber: 2, amount: 791.67, coversInstallment: false }], applied: 3000, unapplied: 0, balanceAfter: 119000, unrecorded: false },
    },
    {
      id: 'p1', creditId: 'cr-1', amount: 3000, method: 'TRANSFER', channel: 'EXTERNAL_CONFIRMED', paymentDate: '2026-11-20T21:23:00Z', createdAt: '2026-11-20T21:23:00Z', registeredAt: '2026-11-20T21:23:00Z', status: 'REGISTERED',
      imputation: { allocations: [{ installmentNumber: 1, amount: 3000, coversInstallment: false }], applied: 3000, unapplied: 0, balanceAfter: 122000, unrecorded: false },
    },
  ],
} as CreditPaymentsView;

describe('Historial de pagos del crédito', () => {
  it('lista cada pago con las cuotas que cubrió, el saldo posterior, el estado y el canal', () => {
    render(<CreditPaymentHistory view={VIEW} />);
    const items = screen.getAllByTestId('credit-payment');
    expect(items).toHaveLength(2);
    const latest = within(items[0]!);
    expect(latest.getByText(/Cuota 1 · completa/)).toBeInTheDocument();
    expect(latest.getByText(/Cuota 2 · parcial/)).toBeInTheDocument();
    expect(latest.getByText(/Saldo después: .*119\.000,00/)).toBeInTheDocument();
    expect(latest.getByText('Registrado')).toBeInTheDocument();
    const first = within(items[1]!);
    expect(first.getByText(/Cuota 1 · parcial/)).toBeInTheDocument();
    expect(first.getByText('Pagó por un canal de la entidad')).toBeInTheDocument();
    // El resumen
    expect(within(screen.getByTestId('payments-summary')).getByText('Pagado en Kobrax')).toBeInTheDocument();
  });

  it('un pago sin imputación guardada lo dice y no inventa un reparto', () => {
    const old = { ...VIEW, payments: [{ ...VIEW.payments[0]!, imputation: { allocations: [], applied: 0, unapplied: 0, balanceAfter: 125000, unrecorded: true } }] } as CreditPaymentsView;
    render(<CreditPaymentHistory view={old} />);
    expect(screen.getByText(/Sin imputación registrada/)).toBeInTheDocument();
    expect(screen.queryByText(/Cuota 1/)).toBeNull();
  });

  it('sin plan (préstamo abierto) avisa y lista los pagos sin imputación', () => {
    render(<CreditPaymentHistory view={{ ...VIEW, plan: null, payments: [{ ...VIEW.payments[0]!, imputation: undefined }] } as CreditPaymentsView} />);
    expect(screen.getByText(/no tiene plan de cuotas/)).toBeInTheDocument();
    expect(screen.getAllByTestId('credit-payment')).toHaveLength(1);
  });

  it('crédito sin pagos: lo dice', () => {
    render(<CreditPaymentHistory view={{ ...VIEW, payments: [] }} />);
    expect(screen.getByText('Todavía no hay pagos registrados para este crédito.')).toBeInTheDocument();
  });
});

describe('Sincronización entre pestañas', () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => vi.useRealTimers());

  it('un aviso de OTRA pestaña sobre ESTE crédito vuelve a leer del servidor; sobre otro crédito, no', async () => {
    render(<CreditSync creditId="cr-1" />);
    notifyCreditChanged('otro');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(refresh).not.toHaveBeenCalled();
    notifyCreditChanged('cr-1');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('al volver a la pestaña (otro navegador o usuario pudo cambiarlo) también vuelve a leer, sin repetir en ráfaga', async () => {
    render(<CreditSync creditId="cr-1" />);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
