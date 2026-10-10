import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DashboardFilters } from './dashboard-filters';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

describe('DashboardFilters · acciones del tablero', () => {
  it('«Editar» y demás acciones van DENTRO de la tarjeta de filtros, no en una fila aparte', () => {
    const { container } = render(
      <DashboardFilters collectors={[]} sources={[]} actions={<button type="button">Editar</button>} />,
    );
    const tarjeta = container.firstElementChild as HTMLElement;
    expect(within(tarjeta).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    // Y está pegado a la derecha de la misma tarjeta.
    expect(screen.getByRole('button', { name: 'Editar' }).parentElement).toHaveClass('ml-auto');
    // Es una sola tarjeta: nada de una fila hermana con el botón.
    expect(container.children).toHaveLength(1);
  });

  it('sin acciones no dibuja el contenedor vacío', () => {
    const { container } = render(<DashboardFilters collectors={[]} sources={[]} />);
    expect(container.querySelector('.ml-auto')).toBeNull();
  });
});
