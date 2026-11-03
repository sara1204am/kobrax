import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaymentItem } from '@kobrax/shared';
import { PaymentsTable } from './payments-table';

const { push, search } = vi.hoisted(() => ({ push: vi.fn(), search: { value: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/pagos',
  useSearchParams: () => new URLSearchParams(search.value),
}));

const ROW: PaymentItem = {
  id: 'p1',
  creditId: 'cr1',
  amount: 100,
  method: 'CASH',
  paymentDate: '2026-10-14T15:00:00.000Z',
  createdAt: '2026-10-14T15:00:00.000Z',
  registeredBy: 'u1',
  registeredByName: 'María Quispe',
};

const OFICIALES = [
  { userId: 'u1', name: 'María Quispe' },
  { userId: 'u2', name: 'Juan Pérez' },
];

function renderTable(officers: { userId: string; name: string }[]) {
  return render(
    <PaymentsTable
      rows={[ROW]}
      meta={{ total: 1, page: 1, limit: 25, pages: 1 }}
      officers={officers}
      currency="BOB"
      // Con un filtro puesto el panel arranca abierto: no hay que tocar nada para ver los controles.
      filtered
      period={{ from: '2026-10-01', to: '2026-10-15' }}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  search.value = '';
  localStorage.clear();
});

describe('PaymentsTable — filtros del ledger', () => {
  it('mantiene período y fuente, y suma medio de pago con los medios reales del sistema', () => {
    renderTable(OFICIALES);
    const panel = screen.getByRole('complementary', { name: 'Filtros' });
    expect(panel).toHaveTextContent('Período');
    expect(panel).toHaveTextContent('Medio de pago');
    for (const medio of ['Efectivo', 'Transferencia', 'QR', 'Tarjeta', 'Pago móvil']) {
      expect(screen.getByRole('checkbox', { name: medio })).toBeInTheDocument();
    }
  });

  it('un administrador o supervisor ve el filtro de oficiales, con buscador y todos los que tiene a su alcance', () => {
    renderTable(OFICIALES);
    expect(screen.getByRole('complementary', { name: 'Filtros' })).toHaveTextContent('Oficial de cobranza');
    expect(screen.getByRole('searchbox', { name: /Oficial de cobranza.*Buscar/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Juan Pérez' })).toBeInTheDocument();
  });

  it('🔴 un cobrador (sin oficiales a quién consultar) no ve un filtro que no puede usar', () => {
    renderTable([]);
    const panel = screen.getByRole('complementary', { name: 'Filtros' });
    expect(panel).not.toHaveTextContent('Oficial de cobranza');
    // Pero conserva los demás.
    expect(panel).toHaveTextContent('Período');
    expect(panel).toHaveTextContent('Medio de pago');
  });

  it('elegir varios oficiales escribe una sola clave, vuelve a la página 1 y no pierde lo que ya estaba', async () => {
    search.value = 'from=2026-10-01&method=CASH&page=4';
    renderTable(OFICIALES);
    await userEvent.click(screen.getByRole('checkbox', { name: 'María Quispe' }));
    const url = new URL(push.mock.calls.at(-1)![0] as string, 'http://x');
    expect(url.searchParams.get('registeredBy')).toBe('u1');
    expect(url.searchParams.get('method')).toBe('CASH');
    expect(url.searchParams.get('from')).toBe('2026-10-01');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('el nombre de quien registró sale de la fila, sin depender de la lista de oficiales', () => {
    renderTable([]);
    expect(screen.getByText('María Quispe', { selector: 'td *, td' })).toBeInTheDocument();
  });
});
