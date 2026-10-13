import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyIncomeForm, type IncomeProfileForm } from '@kobrax/shared';
import { IncomeFields } from './income-fields';

const SOURCES = [
  { code: 'EMPLOYEE', label: 'Asalariado o profesional' },
  { code: 'BUSINESS', label: 'Comerciante o productivo' },
];
const OCCUPATIONS = [
  { code: 'TRANSPORT', label: 'Transportista', metadata: { incomeSource: 'BUSINESS', defaultCycle: 'WEEKLY' } },
  { code: 'PUBLIC_SERVANT', label: 'Funcionario público', metadata: { incomeSource: 'EMPLOYEE', defaultCycle: 'MONTHLY' } },
];

function Harness({ initial = emptyIncomeForm(), sources = SOURCES, occupations = OCCUPATIONS, spy }: { initial?: IncomeProfileForm; sources?: typeof SOURCES; occupations?: typeof OCCUPATIONS; spy?: (v: IncomeProfileForm) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <IncomeFields
      value={value}
      sources={sources}
      occupations={occupations}
      onChange={(v) => {
        setValue(v);
        spy?.(v);
      }}
    />
  );
}

describe('IncomeFields · perfil de ingreso (F4/13 · E3)', () => {
  it('ofrece la fuente y el rubro de la cuenta', () => {
    render(<Harness />);
    expect(screen.getByRole('option', { name: 'Asalariado o profesional' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Transportista' })).toBeTruthy();
  });

  it('elegir un rubro propone la fuente y el ciclo del rubro, sin obligarlos', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await userEvent.selectOptions(screen.getByLabelText('Rubro'), 'TRANSPORT');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ occupationCode: 'TRANSPORT', incomeSourceCode: 'BUSINESS', incomeCycle: 'WEEKLY' }));
  });

  it('🔴 no pisa una fuente o un ciclo que la persona ya eligió', async () => {
    const spy = vi.fn();
    render(<Harness initial={{ ...emptyIncomeForm(), incomeSourceCode: 'BUSINESS', incomeCycle: 'IRREGULAR' }} spy={spy} />);
    await userEvent.selectOptions(screen.getByLabelText('Rubro'), 'TRANSPORT');
    // El rubro propone SEMANAL, pero la persona ya había dicho «sin ritmo fijo»: se respeta.
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ incomeSourceCode: 'BUSINESS', incomeCycle: 'IRREGULAR' }));
  });

  it('el rubro se filtra por la fuente elegida', () => {
    render(<Harness initial={{ ...emptyIncomeForm(), incomeSourceCode: 'EMPLOYEE' }} />);
    expect(screen.queryByRole('option', { name: 'Transportista' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Funcionario público' })).toBeTruthy();
  });

  it('🔴 conserva un rubro guardado que la cuenta sacó del catálogo', () => {
    render(<Harness initial={{ ...emptyIncomeForm(), occupationCode: 'YA_NO_EXISTE' }} />);
    expect((screen.getByLabelText('Rubro') as HTMLSelectElement).value).toBe('YA_NO_EXISTE');
  });

  it('con el catálogo de rubros vacío no dibuja el selector', () => {
    render(<Harness occupations={[]} />);
    expect(screen.queryByLabelText('Rubro')).toBeNull();
  });

  it('con el catálogo de fuentes vacío ofrece las tres fijas', () => {
    render(<Harness sources={[]} />);
    expect(screen.getByRole('option', { name: 'Comerciante o productivo' })).toBeTruthy();
  });

  it('el día solo aparece con un ciclo que lo tiene', async () => {
    render(<Harness />);
    expect(screen.queryByLabelText('Día del mes')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Cada cuánto le llega el dinero'), 'MONTHLY');
    expect(screen.getByLabelText('Día del mes')).toBeTruthy();
  });

  it('en semanal el día es un día de la semana', async () => {
    render(<Harness initial={{ ...emptyIncomeForm(), incomeCycle: 'WEEKLY' }} />);
    expect(screen.getByLabelText('Día de la semana')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Viernes' })).toBeTruthy();
  });

  it('🔴 cambiar a un ciclo sin día borra el día que ya no corresponde', async () => {
    const spy = vi.fn();
    render(<Harness initial={{ ...emptyIncomeForm(), incomeCycle: 'MONTHLY', incomeDay: '15' }} spy={spy} />);
    await userEvent.selectOptions(screen.getByLabelText('Cada cuánto le llega el dinero'), 'DAILY');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ incomeCycle: 'DAILY', incomeDay: '' }));
  });

  it('un día fuera de rango se marca', () => {
    render(<Harness initial={{ ...emptyIncomeForm(), incomeCycle: 'MONTHLY', incomeDay: '40' }} />);
    expect(screen.getByRole('alert').textContent).toContain('no corresponde');
  });
});
