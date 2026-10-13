import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyCollectionForm, type CollectionProfileForm } from '@kobrax/shared';
import { CollectionFields } from './collection-fields';

const MODALITIES = [
  { code: 'AT_BUSINESS', label: 'Visita en el negocio' },
  { code: 'PICK_UP', label: 'Recoger la cuota' },
];

/** Controlado, como lo usa el formulario: el estado vive afuera y cada cambio lo reemplaza. */
function Harness({ initial = emptyCollectionForm(), modalities = MODALITIES, spy }: { initial?: CollectionProfileForm; modalities?: typeof MODALITIES; spy?: (v: CollectionProfileForm) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <CollectionFields
      value={value}
      modalities={modalities}
      onChange={(v) => {
        setValue(v);
        spy?.(v);
      }}
    />
  );
}

describe('CollectionFields · «Cómo cobrarle» (F4/13 · E2)', () => {
  it('ofrece las modalidades del catálogo de la cuenta', () => {
    render(<Harness />);
    expect(screen.getByText('Cómo cobrarle')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Recoger la cuota' })).toBeTruthy();
  });

  it('elegir la modalidad y la frecuencia cambia el perfil', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await userEvent.selectOptions(screen.getByLabelText('Modalidad'), 'PICK_UP');
    await userEvent.selectOptions(screen.getByLabelText('Frecuencia'), 'DAILY');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ modality: 'PICK_UP', frequency: 'DAILY' }));
  });

  it('🔴 conserva una modalidad que la cuenta sacó del catálogo: mostrarla vacía y guardar la borraría', () => {
    render(<Harness initial={{ ...emptyCollectionForm(), modality: 'VIEJA' }} />);
    expect((screen.getByLabelText('Modalidad') as HTMLSelectElement).value).toBe('VIEJA');
  });

  it('con el catálogo vacío no dibuja el selector de modalidad y el resto sigue funcionando', () => {
    render(<Harness modalities={[]} />);
    expect(screen.queryByLabelText('Modalidad')).toBeNull();
    expect(screen.getByLabelText('Frecuencia')).toBeTruthy();
  });

  it('los días se marcan y desmarcan, siempre ordenados', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const days = screen.getByRole('group', { name: 'Días' });
    const botones = days.querySelectorAll('button');
    await userEvent.click(botones[2]!); // miércoles (3)
    await userEvent.click(botones[0]!); // lunes (1)
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ days: [1, 3] }));
    await userEvent.click(botones[2]!);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ days: [1] }));
  });

  it('🔴 una franja con las horas al revés se marca como error', () => {
    render(<Harness initial={{ ...emptyCollectionForm(), windowFrom: '18:00', windowTo: '08:00' }} />);
    expect(screen.getByRole('alert').textContent).toContain('La franja necesita las dos horas');
  });

  it('media franja también es error: sin las dos horas no hay franja', () => {
    render(<Harness initial={{ ...emptyCollectionForm(), windowFrom: '08:00' }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('una franja válida no muestra error', () => {
    render(<Harness initial={{ ...emptyCollectionForm(), windowFrom: '08:00', windowTo: '10:00' }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('la indicación tiene tope de largo', () => {
    render(<Harness />);
    const nota = screen.getByLabelText('Indicación') as HTMLInputElement;
    expect(nota.maxLength).toBe(280);
    fireEvent.change(nota, { target: { value: 'Tocar el portón verde' } });
    expect(nota.value).toBe('Tocar el portón verde');
  });
});
