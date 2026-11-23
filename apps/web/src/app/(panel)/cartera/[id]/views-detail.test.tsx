import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ClientDetail, ClientLocationDetail } from '@kobrax/shared';
import { CollateralsSection } from './backing-sections';
import { LocationDetail } from './client-contacts';

const client = {
  id: 'c1',
  collaterals: [
    { id: 'g1', type: 'OTHER', typeOther: 'Terreno', description: 'Lote en Warnes', estimatedValue: 8000, currency: 'BOB', photoUrls: ['/api/uploads/a.png'], creditIds: ['cr1'] },
  ],
} as unknown as ClientDetail;

describe('detalle de garantías', () => {
  it('el ojo abre TODO lo que se edita: qué es el «Otro», descripción, valor, fotos y qué préstamos respalda', () => {
    render(
      <CollateralsSection
        client={client}
        currency="BOB"
        types={[{ code: 'OTHER', label: 'Otro' }]}
        credits={[{ id: 'cr1', code: 'CR-000001', principalAmount: 1000, outstandingBalance: 900, currency: 'BOB' }]}
        canWrite={false}
        onEdit={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(screen.getAllByText('Terreno').length).toBeGreaterThan(0);
    expect(screen.getByText('Lote en Warnes', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/CR-000001/)).toBeInTheDocument();
  });
});

describe('detalle de dirección', () => {
  it('muestra «Cómo cobrarle» completo: modalidad, quién entrega la cuota, frecuencia, días, franja e indicación', () => {
    const location = {
      id: 'l1',
      locationType: 'HOME',
      address: 'Calle 1',
      visitSchedule: { modality: 'PICK_UP', frequency: 'WEEKLY', days: [3], window: { from: '08:00', to: '10:00' }, handoverBy: 'FAMILY', note: 'Portón verde' },
    } as unknown as ClientLocationDetail;
    render(<LocationDetail location={location} modalities={[{ code: 'PICK_UP', label: 'Recoger la cuota' }]} />);
    expect(screen.getByText('Recoger la cuota')).toBeInTheDocument();
    expect(screen.getByText('Un familiar')).toBeInTheDocument();
    expect(screen.getByText('Una vez por semana')).toBeInTheDocument();
    expect(screen.getByText('08:00 – 10:00')).toBeInTheDocument();
    expect(screen.getByText('Portón verde')).toBeInTheDocument();
    expect(screen.getByText('Quién entrega la cuota')).toBeInTheDocument();
    // Los días: las mismas fichas que al editar, deshabilitadas, con el día elegido marcado y nombre completo.
    const miercoles = screen.getByRole('button', { name: 'Miércoles' });
    expect(miercoles).toBeDisabled();
    expect(miercoles).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lunes' })).toHaveAttribute('aria-pressed', 'false');
  });
});
