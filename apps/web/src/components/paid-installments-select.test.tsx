import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaidInstallmentsSelect } from './paid-installments-select';

const row = (number: number, dueDate: string) => ({ number, dueDate, principal: 100, interest: 10, amount: 110, principalBalance: 0 });
const SCHEDULE = [row(1, '2026-08-12'), row(2, '2026-09-12'), row(3, '2026-10-12'), row(4, '2026-11-12')];

describe('PaidInstallmentsSelect', () => {
  it('cada opción con su fecha, hasta n − 1; la de este mes en negrita y marcada', () => {
    render(<PaidInstallmentsSelect schedule={SCHEDULE} value={0} onChange={() => {}} today={new Date(2026, 8, 26)} />);
    const options = screen.getAllByRole('option');
    // Ninguna + 1..3 (la 4.ª no: un crédito no se registra con todas pagas).
    expect(options).toHaveLength(4);
    expect(options[1]!.textContent).toMatch(/^1 de 4 · .*2026$/);
    const current = options[2]!;
    expect(current.textContent).toMatch(/^2 de 4 · .* · este mes$/);
    expect(current.style.fontWeight).toBe('700');
    expect(options[3]!.style.fontWeight).toBe('');
  });
});
