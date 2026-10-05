import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PsfNotice } from './psf-notice';

describe('PsfNotice — ausente del reporte (D9)', () => {
  it('🔴 dice exactamente que ya no aparece y que pudo ponerse al día o cancelarse; nunca «pagado»', () => {
    const { container } = render(<PsfNotice externalSource="PSF" syncStatus="ABSENT" absentSince="2026-10-03" reportedAsOf="2026-10-01" />);
    expect(
      screen.getByText('Ya no aparece en el reporte del 03/10. Puede haberse puesto al día o cancelado; el reporte no lo dice.'),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pagad/i);
  });

  it('sin fecha de ausencia usa la del corte; sin ninguna, el texto sin fecha', () => {
    const { rerender } = render(<PsfNotice externalSource="PSF" syncStatus="ABSENT" reportedAsOf="2026-09-30" />);
    expect(screen.getByText(/Ya no aparece en el reporte del 30\/09\./)).toBeInTheDocument();
    rerender(<PsfNotice externalSource="PSF" syncStatus="ABSENT" />);
    expect(screen.getByText(/^Ya no aparece en el reporte\. Puede haberse puesto al día o cancelado/)).toBeInTheDocument();
  });

  it('dato viejo (y presente): el aviso de siempre', () => {
    render(<PsfNotice externalSource="PSF" syncStatus="PRESENT" reportedAsOf="2026-09-20" reportedStale />);
    expect(screen.getByRole('status')).toHaveTextContent('Dato desactualizado');
    expect(screen.getByRole('status')).toHaveTextContent('20/09');
  });

  it('ausente gana sobre viejo, y un crédito propio o al día en el reporte no muestra nada', () => {
    const { container, rerender } = render(<PsfNotice externalSource="PSF" syncStatus="ABSENT" reportedStale absentSince="2026-10-03" />);
    expect(screen.queryByText('Dato desactualizado')).toBeNull();
    rerender(<PsfNotice syncStatus="ABSENT" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PsfNotice externalSource="PSF" syncStatus="PRESENT" />);
    expect(container).toBeEmptyDOMElement();
  });
});
