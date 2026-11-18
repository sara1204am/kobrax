import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  CreditDefinition,
  InterestType,
  PaymentFrequency,
  emptyWorkspace,
  initialCreditForm,
  type CreditForm,
  type Workspace,
} from '@kobrax/shared';
import { CreditTermsFields } from './credit-terms-fields';
import { WorkspaceProvider } from './workspace';

const ws = (options: Workspace['options'] = {}): Workspace => ({ ...emptyWorkspace(), options });

function Harness({ initial, workspace }: { initial?: Partial<CreditForm>; workspace?: Workspace }) {
  const [form, setForm] = useState<CreditForm>({ ...initialCreditForm('2026-12-15'), ...initial });
  return (
    <WorkspaceProvider workspace={workspace}>
      <CreditTermsFields form={form} onChange={setForm} />
    </WorkspaceProvider>
  );
}

const DEFINICION = '¿Cómo querés definir el crédito?';
const AVANZADAS = 'Opciones avanzadas';
const MORA = 'Cómo se cuenta la mora';
const TIPO_INTERES = 'Tipo de interés';
const FRECUENCIA = 'Frecuencia de pago';

describe('CreditTermsFields · espacio de trabajo (F15 · P3)', () => {
  it('🔴 A-1: sin workspace (o «Completo») el formulario es el de hoy: selector de modalidad y bloque avanzado completo', () => {
    render(<Harness />);
    expect(screen.getByText(DEFINICION)).toBeInTheDocument();
    expect(screen.getByText(AVANZADAS)).toBeInTheDocument();
    expect(screen.getByText(MORA)).toBeInTheDocument();
    expect(screen.getByText(TIPO_INTERES)).toBeInTheDocument();
  });

  it('con la modalidad fija no hay selector de modalidad', () => {
    render(
      <Harness
        initial={{ definition: CreditDefinition.AGREED_INSTALLMENT }}
        workspace={ws({ 'credit.definition': 'agreed_installment' })}
      />,
    );
    expect(screen.queryByText(DEFINICION)).not.toBeInTheDocument();
  });

  it('🔴 A-6 / R7: un crédito que se abre con OTRA modalidad que la fija sí la muestra (lo guardado nunca se esconde)', () => {
    render(
      <Harness
        initial={{ definition: CreditDefinition.CALCULATED }}
        workspace={ws({ 'credit.definition': 'agreed_installment' })}
      />,
    );
    expect(screen.getByText(DEFINICION)).toBeInTheDocument();
  });

  it('sin «avanzadas» desaparecen tipo de interés, convención, base, seguro y cargos; el método de mora se conserva (C-4)', () => {
    render(<Harness workspace={ws({ 'credit.advanced': false })} />);
    expect(screen.getByText(AVANZADAS)).toBeInTheDocument();
    expect(screen.getByText(MORA)).toBeInTheDocument();
    expect(screen.queryByText(TIPO_INTERES)).not.toBeInTheDocument();
    expect(screen.queryByText('Tipo de tasa')).not.toBeInTheDocument();
    expect(screen.queryByText('Desgravamen (% mensual)')).not.toBeInTheDocument();
    expect(screen.queryByText('Otros cargos')).not.toBeInTheDocument();
  });

  it('sin «avanzadas» y sin método de mora, el bloque entero no se dibuja', () => {
    render(<Harness workspace={ws({ 'credit.advanced': false, 'credit.arrearsMethod': false })} />);
    expect(screen.queryByText(AVANZADAS)).not.toBeInTheDocument();
    expect(screen.queryByText(MORA)).not.toBeInTheDocument();
  });

  it('🔴 G6: con una modalidad acordada y el método de mora oculto no queda un «Opciones avanzadas» que abre a un panel vacío', () => {
    render(
      <Harness
        initial={{ definition: CreditDefinition.AGREED_INSTALLMENT }}
        workspace={ws({ 'credit.arrearsMethod': false })}
      />,
    );
    expect(screen.queryByText(AVANZADAS)).not.toBeInTheDocument();
  });

  it('el método de mora oculto deja el resto de «avanzadas»', () => {
    render(<Harness workspace={ws({ 'credit.arrearsMethod': false })} />);
    expect(screen.getByText(AVANZADAS)).toBeInTheDocument();
    expect(screen.queryByText(MORA)).not.toBeInTheDocument();
    expect(screen.getByText(TIPO_INTERES)).toBeInTheDocument();
  });

  it('🔴 R7: un crédito con seguro o interés compuesto ya guardado muestra «avanzadas» aunque la organización las haya ocultado', () => {
    render(
      <Harness
        initial={{ insuranceMonthlyPercent: '0.05' }}
        workspace={ws({ 'credit.advanced': false, 'credit.arrearsMethod': false })}
      />,
    );
    expect(screen.getByText('Desgravamen (% mensual)')).toBeInTheDocument();
    render(
      <Harness
        initial={{ interestType: InterestType.COMPOUND }}
        workspace={ws({ 'credit.advanced': false, 'credit.arrearsMethod': false })}
      />,
    );
    expect(screen.getAllByText(TIPO_INTERES).length).toBeGreaterThan(0);
  });

  it('las frecuencias se limitan a las permitidas', () => {
    render(
      <Harness
        initial={{ frequency: PaymentFrequency.WEEKLY }}
        workspace={ws({ 'credit.frequencies': ['WEEKLY', 'DAILY'] })}
      />,
    );
    const options = screen.getByLabelText(FRECUENCIA).querySelectorAll('option');
    expect([...options].map((o) => o.getAttribute('value')).sort()).toEqual(['DAILY', 'WEEKLY']);
  });

  it('🔴 R7: la frecuencia ya guardada se ofrece aunque ya no esté permitida', () => {
    render(
      <Harness
        initial={{ frequency: PaymentFrequency.MONTHLY }}
        workspace={ws({ 'credit.frequencies': ['WEEKLY'] })}
      />,
    );
    const values = [...screen.getByLabelText(FRECUENCIA).querySelectorAll('option')]
      .map((o) => o.getAttribute('value'))
      .sort();
    expect(values).toEqual(['MONTHLY', 'WEEKLY']);
  });

  it('sin restricción se ofrecen todas las de siempre', () => {
    render(<Harness />);
    expect(screen.getByLabelText(FRECUENCIA).querySelectorAll('option')).toHaveLength(4);
  });
});
