import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { UpdatedPlan, UpdatedPlanRow } from '@kobrax/shared';
import { OverdueInstallmentsSection } from './overdue-installments-section';

const row = (over: Partial<UpdatedPlanRow>): UpdatedPlanRow => ({
  number: 1, dueDate: '2026-11-19', amount: 1000, paid: 0, pending: 1000, status: 'OVERDUE', daysPastDue: 62, prepaid: false, ...over,
});
const plan = (rows: UpdatedPlanRow[], over: Partial<UpdatedPlan> = {}): UpdatedPlan => ({
  rows, planTotal: 4000, prepaidAmount: 0, collectedAmount: 0, unappliedAmount: 0, balance: 4000,
  overdueAmount: rows.filter((r) => r.status === 'OVERDUE').reduce((s, r) => s + r.pending, 0),
  overdueCount: rows.filter((r) => r.status === 'OVERDUE').length, nextPayment: null, situation: 'OVERDUE', baseDaysPastDue: 62, payments: [], ...over,
});

describe('OverdueInstallmentsSection — la mora por cuota', () => {
  it('🔴 lista SÓLO las cuotas vencidas, cada una con SUS días', () => {
    render(
      <OverdueInstallmentsSection
        currency="BOB"
        plan={plan([row({}), row({ number: 2, dueDate: '2026-12-19', daysPastDue: 32 }), row({ number: 3, dueDate: '2027-02-19', status: 'PENDING', daysPastDue: 0 })])}
      />,
    );
    const rows = within(screen.getByTestId('overdue-installments')).getAllByRole('row');
    expect(rows).toHaveLength(3); // cabecera + 2 vencidas (la 3 no vence todavía)
    expect(within(rows[1]!).getByText('62 días')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('32 días')).toBeInTheDocument();
    expect(within(screen.getByTestId('overdue-summary')).getByText(/2\.000,00/)).toBeInTheDocument();
  });

  it('con la partición, muestra capital vencido e interés corriente vencido por separado, y por cuota', () => {
    render(
      <OverdueInstallmentsSection
        currency="BOB"
        plan={plan([row({ interestPending: 100, principalPending: 900 })], { overduePrincipal: 900, overdueInterest: 100 })}
      />,
    );
    const summary = within(screen.getByTestId('overdue-summary'));
    expect(summary.getByText('Capital vencido')).toBeInTheDocument();
    expect(summary.getByText('Interés corriente vencido')).toBeInTheDocument();
    expect(screen.getByText(/capital\s+Bs\s?900,00 · interés\s+Bs\s?100,00/)).toBeInTheDocument();
  });

  it('sin cuotas vencidas lo dice; sin plan no dibuja nada', () => {
    const { unmount, container } = render(<OverdueInstallmentsSection currency="BOB" plan={plan([row({ status: 'PENDING', daysPastDue: 0 })], { situation: 'CURRENT' })} />);
    expect(screen.getByText('No tiene cuotas vencidas.')).toBeInTheDocument();
    unmount();
    const empty = render(<OverdueInstallmentsSection currency="BOB" plan={undefined} />);
    expect(empty.container).toBeEmptyDOMElement();
    void container;
  });

  it('🔴 aclara que NO hay cargos por mora adicionales: sólo atraso y lo vencido', () => {
    render(<OverdueInstallmentsSection currency="BOB" plan={plan([row({})])} />);
    expect(screen.getByText(/no suma intereses moratorios/)).toBeInTheDocument();
  });
});
