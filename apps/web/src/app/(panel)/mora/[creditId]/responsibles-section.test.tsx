import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MoraAssignment } from '@kobrax/shared';
import { ResponsiblesSection } from './responsibles-section';

const { refresh, toast, send } = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), send: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));
vi.mock('@/lib/client', async (orig) => ({ ...(await orig<typeof import('@/lib/client')>()), sendJson: send }));

const PEOPLE = [
  { userId: 'u1', name: 'Carlos Mamani' },
  { userId: 'u2', name: 'Lucía Rojas' },
  { userId: 'u3', name: 'Pedro Quispe' },
];
const ASSIGNMENTS: MoraAssignment[] = [
  { kind: 'PRINCIPAL', userId: 'u1' },
  { id: 'as-t', kind: 'TEMPORAL', userId: 'u2', expiresAt: '2026-10-20T03:59:59.000Z' },
  { id: 'as-a', kind: 'APOYO', userId: 'u3' },
];

/** La lista de responsables (el modal cerrado también tiene los nombres en su selector). */
const list = () => within(screen.getByRole('list'));

function renderSection(props: Partial<React.ComponentProps<typeof ResponsiblesSection>> = {}) {
  return render(<ResponsiblesSection creditId="cr1" assignments={ASSIGNMENTS} people={PEOPLE} collectors={PEOPLE} canAssign {...props} />);
}

/** Dentro de dos días, en hora local, `YYYY-MM-DD`. */
const inTwoDays = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  send.mockReset();
});

describe('ResponsiblesSection', () => {
  it('muestra el responsable, el reemplazo temporal con su vencimiento y la ayuda, con nombre', () => {
    renderSection();
    expect(list().getByText('Carlos Mamani')).toBeInTheDocument();
    expect(screen.getByText('Reemplazo temporal')).toBeInTheDocument();
    expect(list().getByText('Lucía Rojas')).toBeInTheDocument();
    expect(screen.getByText(/hasta el/)).toBeInTheDocument();
    expect(list().getByText('Pedro Quispe')).toBeInTheDocument();
  });

  it('🔴 sin nombre no se muestra el id: dice «Asignado»', () => {
    renderSection({ people: [], assignments: [{ kind: 'PRINCIPAL', userId: 'bf2e039c-ea1b-4628-883e-8ed117f47bc6' }] });
    expect(screen.getByText('Asignado')).toBeInTheDocument();
    expect(screen.queryByText(/bf2e039c/)).toBeNull();
  });

  it('sin assignment:write ve la lista y ninguna acción', () => {
    renderSection({ canAssign: false });
    expect(list().getByText('Lucía Rojas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar ayuda' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cambiar temporalmente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull();
  });

  it('quitar una cobertura: DELETE sobre la asignación (el responsable no tiene «Quitar»)', async () => {
    send.mockResolvedValue({ ok: true, status: 204, data: {} });
    renderSection();
    const quitar = screen.getAllByRole('button', { name: 'Quitar' });
    expect(quitar).toHaveLength(2);
    await userEvent.click(quitar[0]!);
    await waitFor(() => expect(send).toHaveBeenCalledWith('/api/assignments/as-t', {}, 'DELETE'));
    expect(refresh).toHaveBeenCalled();
  });

  it('cambiar temporalmente: exige cobrador y vencimiento antes de mandar', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar temporalmente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText('Elegí al cobrador y la fecha de vencimiento.')).toBeInTheDocument();
  });

  it('cambiar temporalmente: manda creditId, cobrador, vencimiento y motivo', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {} });
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar temporalmente' }));
    await userEvent.selectOptions(screen.getByLabelText('Cobrador'), 'u2');
    await userEvent.type(screen.getByLabelText('Fecha de vencimiento'), inTwoDays());
    await userEvent.type(screen.getByLabelText('Motivo (opcional)'), 'Vacaciones');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    const [path, body] = send.mock.calls[0]!;
    expect(path).toBe('/api/assignments/temporary');
    expect(body).toMatchObject({ creditId: 'cr1', userId: 'u2', reason: 'Vacaciones' });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(toast).toHaveBeenCalledWith('Reemplazo temporal creado');
  });

  it('agregar ayuda: el vencimiento es opcional', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {} });
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar ayuda' }));
    await userEvent.selectOptions(screen.getByLabelText('Cobrador'), 'u3');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('/api/assignments/support', { creditId: 'cr1', userId: 'u3' }));
    expect(toast).toHaveBeenCalledWith('Ayuda agregada');
  });

  it('un error de la API se muestra en el modal', async () => {
    send.mockResolvedValue({ ok: false, status: 403, data: { error: { code: 'ASSIGNMENT_OUT_OF_AGENCY', message: 'Fuera de tu agencia' } } });
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar ayuda' }));
    await userEvent.selectOptions(screen.getByLabelText('Cobrador'), 'u3');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Fuera de tu agencia')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
