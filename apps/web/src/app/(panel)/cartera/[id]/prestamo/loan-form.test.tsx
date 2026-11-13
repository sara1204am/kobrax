import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/toast';
import { WorkspaceProvider } from '@/components/workspace';
import { LoanForm } from './loan-form';

const { postJson } = vi.hoisted(() => ({ postJson: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/client', () => ({ postJson }));
// El motor de cotización no es lo que se prueba: se fija un formulario ya válido.
vi.mock('@kobrax/shared', async (orig) => {
  const real = await orig<typeof import('@kobrax/shared')>();
  return {
    ...real,
    creditFormState: (f: Parameters<typeof real.creditFormState>[0]) => ({ ...real.creditFormState(f), canSubmit: true }),
    buildNewCreditPayload: (_f: unknown, clientId: string) => ({ clientId }),
  };
});

const OFFICES = [
  { id: 'c', name: 'Central', depth: 0 },
  { id: 'mv', name: 'Central › Chuquisaca › Mesa Verde', depth: 2 },
];

function draw(props: Partial<React.ComponentProps<typeof LoanForm>> = {}) {
  return render(
    <ToastProvider>
      <LoanForm clientId="cl1" clientName="Ana" assignees={[]} currency="BOB" {...props} />
    </ToastProvider>,
  );
}

beforeEach(() => postJson.mockReset());

describe('LoanForm · oficina del crédito (F13)', () => {
  it('con una sola oficina no hay selector y no se envía branchId', async () => {
    postJson.mockResolvedValue({ ok: true, data: { id: 'cr1' } });
    draw();
    expect(screen.queryByLabelText(/Oficina del crédito/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /guardar|crear|registrar/i }));
    expect(postJson).toHaveBeenCalledWith('/api/credits', { clientId: 'cl1' });
  });

  it('con varias aparece con la ruta completa, exige elegir y envía branchId', async () => {
    postJson.mockResolvedValue({ ok: true, data: { id: 'cr1' } });
    draw({ offices: OFFICES });
    const select = screen.getByLabelText(/Oficina del crédito/);
    const save = screen.getByRole('button', { name: /guardar|crear|registrar/i });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(select, 'mv');
    await userEvent.click(save);
    expect(postJson).toHaveBeenCalledWith('/api/credits', { clientId: 'cl1', branchId: 'mv' });
  });

  it('preselecciona la oficina de la persona', () => {
    draw({ offices: OFFICES, defaultOfficeId: 'mv' });
    expect(screen.getByLabelText(/Oficina del crédito/)).toHaveValue('mv');
  });

  it('CREDIT_BRANCH_UNRESOLVED se explica: elige la oficina del crédito', async () => {
    postJson.mockResolvedValue({ ok: false, data: { error: { code: 'CREDIT_BRANCH_UNRESOLVED', message: 'raw' } } });
    draw({ offices: OFFICES, defaultOfficeId: 'c' });
    await userEvent.click(screen.getByRole('button', { name: /guardar|crear|registrar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Elige la oficina del crédito');
  });
});

describe('LoanForm · espacio de trabajo (F15 · P3)', () => {
  const wsFija = { version: 1, rev: 1, hiddenModules: [], options: { 'credit.definition': 'agreed_installment' } } as never;

  it('🔴 A-6: con la modalidad fija no hay selector de modalidad y el alta arranca con ella', () => {
    render(
      <ToastProvider>
        <WorkspaceProvider workspace={wsFija}>
          <LoanForm clientId="cl1" clientName="Ana" assignees={[]} currency="BOB" />
        </WorkspaceProvider>
      </ToastProvider>,
    );
    expect(screen.queryByText('¿Cómo querés definir el crédito?')).not.toBeInTheDocument();
    // «Cuota acordada»: el campo de la cuota (que solo existe en esa modalidad) está, y el del interés no.
    expect(screen.getByLabelText('Cuota acordada')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Interés \(%\)/)).not.toBeInTheDocument();
  });

  it('A-1: sin workspace el selector de modalidad sigue estando', () => {
    draw();
    expect(screen.getByText('¿Cómo querés definir el crédito?')).toBeInTheDocument();
  });
});
