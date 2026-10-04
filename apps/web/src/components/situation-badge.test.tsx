import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SituationBadge } from './situation-badge';

describe('SituationBadge', () => {
  it('al día: chip verde y sin detalle de mora', () => {
    render(<SituationBadge situation="CURRENT" daysPastDue={0} writtenOff={false} />);
    expect(screen.getByText('Al día')).toBeInTheDocument();
    expect(screen.queryByText(/de mora/)).toBeNull();
    expect(screen.queryByText('Castigado')).toBeNull();
  });

  it('en mora: chip y «Categoría B · 47 días de mora» con la categoría de la API', () => {
    render(<SituationBadge situation="IN_ARREARS" daysPastDue={47} category={{ code: 'B', name: 'Mora media', color: '#f59e0b' }} />);
    expect(screen.getByText('En mora')).toBeInTheDocument();
    expect(screen.getByText('Categoría B · 47 días de mora')).toBeInTheDocument();
    expect(screen.getByTestId('category-dot')).toHaveStyle({ backgroundColor: '#f59e0b' });
  });

  it('castigado: va además de la situación, con los días y la categoría al final', () => {
    render(<SituationBadge situation="IN_ARREARS" daysPastDue={240} category={{ code: 'C', name: 'C' }} writtenOff />);
    expect(screen.getByText('En mora')).toBeInTheDocument();
    expect(screen.getByText('Castigado')).toBeInTheDocument();
    expect(screen.getByText('240 días de mora · Categoría C')).toBeInTheDocument();
  });

  it('castigado y al día: sigue siendo castigado', () => {
    render(<SituationBadge situation="CURRENT" daysPastDue={0} writtenOff />);
    expect(screen.getByText('Al día')).toBeInTheDocument();
    expect(screen.getByText('Castigado')).toBeInTheDocument();
  });

  it('🔴 sin categoría no se inventa ninguna: sólo los días', () => {
    render(<SituationBadge situation="IN_ARREARS" daysPastDue={1} />);
    expect(screen.getByText('1 día de mora')).toBeInTheDocument();
    expect(screen.queryByText(/Categoría/)).toBeNull();
    expect(screen.queryByTestId('category-dot')).toBeNull();
  });
});
