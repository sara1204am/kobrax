import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/messages/es.json';
import { emptyWorkspace, initialCliente, type ClienteForm, type Workspace } from '@kobrax/shared';
import { ClientFormFields } from './client-form';
import { WorkspaceProvider } from './workspace';

const ws = (options: Workspace['options'] = {}): Workspace => ({ ...emptyWorkspace(), options });

function Harness({
  initial,
  workspace,
}: {
  initial?: Partial<ClienteForm>;
  workspace?: Workspace;
}) {
  const [form, setForm] = useState<ClienteForm>({ ...initialCliente(), ...initial });
  return (
    // `useFormatter` (el valor estimado de una garantía) necesita el contexto real de next-intl.
    <NextIntlClientProvider locale="es" messages={es}>
      <WorkspaceProvider workspace={workspace}>
        <ClientFormFields form={form} onChange={setForm} currency="BOB" />
      </WorkspaceProvider>
    </NextIntlClientProvider>
  );
}

const INGRESOS = 'Perfil de ingreso';
const GARANTES = 'Garantes y contactos';
const GARANTIAS = 'Garantías';
const GENERO = 'Género';
const CANAL = 'Canal de contacto preferido';

const todoOculto = ws({
  'client.income': false,
  'client.guarantors': false,
  'client.collateral': false,
  'client.gender': false,
  'client.preferredChannel': false,
});

describe('ClientFormFields · espacio de trabajo (F15 · P3)', () => {
  it('🔴 A-1: sin workspace el alta es la de hoy', () => {
    render(<Harness />);
    for (const label of [INGRESOS, GARANTES, GARANTIAS])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(GENERO)).toBeInTheDocument();
    expect(screen.getByText(CANAL)).toBeInTheDocument();
  });

  it('con todo oculto desaparecen Ingresos, Garantes, Garantías, género y canal preferido', () => {
    render(<Harness workspace={todoOculto} />);
    for (const label of [INGRESOS, GARANTES, GARANTIAS, GENERO, CANAL])
      expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  it('lo que NO se oculta sigue (identificación y contactos: son del grupo P, no tienen opción)', () => {
    render(<Harness workspace={todoOculto} />);
    expect(screen.getByText('Identificación')).toBeInTheDocument();
    expect(screen.getByText('Contacto')).toBeInTheDocument();
  });

  it('🔴 R7: un cliente que ya trae género, canal, ingresos, garantes o garantías los muestra aunque se hayan ocultado', () => {
    render(
      <Harness
        workspace={todoOculto}
        initial={{
          gender: 'F',
          preferredContactChannel: 'WHATSAPP',
          income: {
            incomeSourceCode: 'SALARY',
            occupationCode: '',
            incomeCycle: '',
            incomeDay: '',
            notes: '',
          },
          relations: [
            {
              id: 'r1',
              relatedName: 'Pedro',
              relationshipType: 'GUARANTOR',
              gender: '',
              isContactable: true,
              notes: '',
              contacts: [],
              locations: [],
              creditIds: [],
            } as never,
          ],
          collaterals: [
            {
              id: 'k1',
              type: '',
              description: 'Moto',
              estimatedValue: '',
              currency: '',
              photoUrls: [],
              creditIds: [],
            } as never,
          ],
        }}
      />,
    );
    for (const label of [INGRESOS, GARANTES, GARANTIAS, CANAL])
      expect(screen.getByText(label)).toBeInTheDocument();
    // «Género» aparece también en la fila del garante: basta con que el del cliente esté.
    expect(screen.getAllByText(GENERO).length).toBeGreaterThan(0);
  });

  it('cada opción es independiente: ocultar solo Garantías deja lo demás', () => {
    render(<Harness workspace={ws({ 'client.collateral': false })} />);
    expect(screen.queryByText(GARANTIAS)).not.toBeInTheDocument();
    for (const label of [INGRESOS, GARANTES, GENERO, CANAL])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('🔴 G6: vaciar el valor a mitad de edición NO hace desaparecer el campo (se decide con lo que el cliente traía al abrir)', async () => {
    render(
      <Harness
        workspace={ws({ 'client.gender': false, 'client.preferredChannel': false })}
        initial={{ gender: 'F', preferredContactChannel: 'WHATSAPP' }}
      />,
    );
    const gender = screen.getAllByLabelText(GENERO)[0] as HTMLSelectElement;
    await userEvent.selectOptions(gender, '');
    expect(screen.getAllByLabelText(GENERO).length).toBeGreaterThan(0);
    const channel = screen.getByLabelText(CANAL) as HTMLSelectElement;
    await userEvent.selectOptions(channel, '');
    expect(screen.getByLabelText(CANAL)).toBeInTheDocument();
  });
});
