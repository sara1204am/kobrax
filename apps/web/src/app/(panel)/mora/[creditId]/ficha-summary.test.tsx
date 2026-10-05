import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Section } from '@/components/panel-ui';
import { FichaSummary, paidPercent } from './ficha-summary';

describe('paidPercent', () => {
  it('cuánto del capital original ya no se debe', () => {
    expect(paidPercent(8500, 7011.42)).toBe(18);
    expect(paidPercent(1000, 0)).toBe(100);
    expect(paidPercent(1000, 1000)).toBe(0);
  });

  it('sin capital o sin saldo no hay porcentaje: no se inventa', () => {
    expect(paidPercent(undefined, 500)).toBeUndefined();
    expect(paidPercent(1000, undefined)).toBeUndefined();
    expect(paidPercent(0, 0)).toBeUndefined();
  });

  it('un saldo mayor al capital (intereses) no da negativo, ni uno menor a cero pasa de 100', () => {
    expect(paidPercent(1000, 1500)).toBe(0);
    expect(paidPercent(1000, -50)).toBe(100);
  });
});

const props = {
  chips: <span>etiquetas</span>,
  balance: 7011.42,
  principal: 8500,
  overdue: 5586.12,
  daysPastDue: 393,
  installment: 333.48,
  nextDueDate: '02 nov 2026',
  lastPayment: '—',
  moraSince: '—',
  lastAction: '03 oct 2026',
  activePromise: 'Bs 300.00 · 10 oct 2026',
  assignee: 'Sin cobrador',
  branch: 'Sucursal Central',
  clientHref: '/cartera/c1',
  creditHref: '/cartera/c1/credito/cr1',
  amount: (n: number | undefined) => (n === undefined ? '—' : `Bs ${n.toFixed(2)}`),
};

describe('FichaSummary', () => {
  it('a la izquierda lo que se debe y cuánto se pagó; a la derecha los datos', () => {
    render(<FichaSummary {...props} />);
    expect(screen.getByText('Saldo pendiente')).toBeInTheDocument();
    expect(screen.getByText('Bs 7011.42')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /capital ya pagado/i })).toHaveAttribute('aria-valuenow', '18');
    expect(screen.getByText('Bs 5586.12')).toBeInTheDocument();
    expect(screen.getByText('Mora actual')).toBeInTheDocument();
    expect(screen.getByText('393 d')).toHaveClass('text-k-danger');
    expect(screen.getByText('Sucursal Central')).toBeInTheDocument();
  });

  it('un dato que no hay es «—», no 0, y sin capital no hay barra', () => {
    render(<FichaSummary {...props} principal={undefined} overdue={undefined} installment={undefined} branch={undefined} daysPastDue={0} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Bs 0/)).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(4);
  });

  it('última gestión y promesa vigente son datos sueltos, sin ninguna etiqueta de estado', () => {
    render(<FichaSummary {...props} />);
    expect(screen.getByText('Última gestión')).toBeInTheDocument();
    expect(screen.getByText('03 oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Promesa vigente')).toBeInTheDocument();
    expect(screen.getByText('Bs 300.00 · 10 oct 2026')).toBeInTheDocument();
    expect(screen.queryByText(/En gestión|Con promesa|Promesa incumplida|Sin gestión/)).toBeNull();
  });

  it('los enlaces llevan al deudor y al crédito en Cartera', () => {
    render(<FichaSummary {...props} />);
    expect(screen.getByRole('link', { name: 'Ver la ficha del deudor' })).toHaveAttribute('href', '/cartera/c1');
    expect(screen.getByRole('link', { name: 'Ver el crédito en Cartera' })).toHaveAttribute('href', '/cartera/c1/credito/cr1');
  });
});

describe('Section plegable (acordeón)', () => {
  it('cerrada por defecto, con el contador en el rótulo', () => {
    const { container } = render(
      <Section title="Pagos" collapsible={{ count: 3 }}>
        <p>contenido</p>
      </Section>,
    );
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByRole('heading', { name: /Pagos/ })).toHaveTextContent('Pagos(3)');
  });

  it('abierta de entrada cuando se pide', () => {
    const { container } = render(
      <Section title="Gestiones" collapsible={{ open: true, count: 2 }}>
        <p>contenido</p>
      </Section>,
    );
    expect(container.querySelector('details')!.open).toBe(true);
  });

  it('sin contador (cero) no muestra «(0)»', () => {
    render(
      <Section title="Notas" collapsible={{ count: 0 }}>
        <p>x</p>
      </Section>,
    );
    expect(screen.getByRole('heading', { name: 'Notas' })).toBeInTheDocument();
  });

  it('🔴 la acción va adentro, no en el encabezado (tocarlo pliega)', () => {
    const { container } = render(
      <Section title="Notas" collapsible={{ open: true }} action={<button type="button">Agregar</button>}>
        <p>x</p>
      </Section>,
    );
    expect(container.querySelector('summary')!.querySelector('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument();
  });

  it('sin `collapsible` sigue siendo la sección de siempre (sin details)', () => {
    const { container } = render(
      <Section title="Resumen">
        <p>x</p>
      </Section>,
    );
    expect(container.querySelector('details')).toBeNull();
  });
});
