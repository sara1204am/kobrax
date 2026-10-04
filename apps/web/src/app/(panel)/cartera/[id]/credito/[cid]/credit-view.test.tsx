import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CreditDetail } from '@kobrax/shared';
import { PermissionsProvider } from '@/components/permissions';
import { CreditView } from './credit-view';

function credit(over: Partial<CreditDetail> = {}): CreditDetail {
  return {
    id: 'cr-1',
    code: 'C-1',
    clientId: 'cl-1',
    principalAmount: 1000,
    outstandingBalance: 800,
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

function draw(c: CreditDetail, permissions: string[]) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <CreditView credit={c} team={[]} types={[]} />
    </PermissionsProvider>,
  );
}

describe('CreditView · Gestión de cobranza (F4/08 · D4)', () => {
  it('un crédito AL DÍA también lleva a la ficha de mora, con su situación', () => {
    draw(credit(), ['collection:read']);
    expect(screen.getByRole('link', { name: 'Abrir gestión de cobranza' })).toHaveAttribute('href', '/mora/cr-1');
    expect(within(screen.getByRole('region', { name: 'Gestión de cobranza' })).getByText('Al día')).toBeInTheDocument();
  });

  it('un crédito en mora muestra En mora y los días', () => {
    draw(credit({ daysPastDue: 40 }), ['collection:read']);
    expect(within(screen.getByRole('region', { name: 'Gestión de cobranza' })).getByText('En mora')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir gestión de cobranza' })).toBeInTheDocument();
  });

  it('sin collection:read no se ofrece el enlace', () => {
    draw(credit(), ['credit:read']);
    expect(screen.queryByRole('link', { name: 'Abrir gestión de cobranza' })).not.toBeInTheDocument();
  });
});
