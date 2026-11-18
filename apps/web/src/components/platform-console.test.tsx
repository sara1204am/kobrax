import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformConsole, type PlatformAccount, type PlatformReport } from './platform-console';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));
const sendJson = vi.fn();
const postJson = vi.fn();
vi.mock('@/lib/client', () => ({
  sendJson: (...a: unknown[]) => sendJson(...a),
  postJson: (...a: unknown[]) => postJson(...a),
}));

const report: PlatformReport = {
  id: 'abcdef12-0000-4000-8000-000000000000',
  subjectKind: 'THIRD_PARTY',
  type: 'ABUSE_REPORT',
  status: 'RECEIVED',
  reportedSubject: 'Cobranzas Sur',
  description: 'Me llaman a toda hora y a mi trabajo.',
  rejectionReason: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  allowedNext: ['IN_REVIEW', 'REJECTED'],
  requester: { email: 'persona@ejemplo.com', name: null },
  events: [],
};
const active: PlatformAccount = { accountId: '11111111-1111-4111-8111-111111111111', businessName: 'Cobranzas Sur', status: 'ACTIVE', planCode: 'FREE', createdAt: '2026-01-01T00:00:00.000Z', ownerEmail: 'dueno@sur.com' };
const suspended: PlatformAccount = { ...active, accountId: '22222222-2222-4222-8222-222222222222', businessName: 'Cobros Norte', status: 'SUSPENDED' };

describe('PlatformConsole', () => {
  beforeEach(() => {
    sendJson.mockReset();
    postJson.mockReset();
    replace.mockReset();
  });

  it('muestra el reporte de una persona sin cuenta con sus acciones válidas', () => {
    render(<PlatformConsole initialReports={[report]} initialAccounts={[]} />);
    expect(screen.getByText('persona@ejemplo.com')).toBeInTheDocument();
    expect(screen.getByText(/Persona sin cuenta/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pasar a revisión' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('🔴 rechazar exige justificación: sin texto no llama al servidor', async () => {
    render(<PlatformConsole initialReports={[report]} initialAccounts={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar', hidden: true }));
    expect(await within(dialog).findByText(/Escribe la justificación/)).toBeInTheDocument();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('cambia el estado y refleja el resultado en la lista', async () => {
    sendJson.mockResolvedValue({ ok: true, status: 200, data: { ...report, status: 'IN_REVIEW', allowedNext: ['NEEDS_INFO', 'APPROVED', 'REJECTED'] } });
    render(<PlatformConsole initialReports={[report]} initialAccounts={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pasar a revisión' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar', hidden: true }));
    await waitFor(() => expect(sendJson).toHaveBeenCalled());
    expect(sendJson.mock.calls[0]![0]).toBe(`/api/plataforma/reportes/${report.id}/status`);
    expect(sendJson.mock.calls[0]![1]).toMatchObject({ status: 'IN_REVIEW' });
    expect(await screen.findByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
    // El correo de quien escribió se conserva aunque la respuesta no lo traiga.
    expect(screen.getByText('persona@ejemplo.com')).toBeInTheDocument();
  });

  it('🔴 una sesión vencida (401) manda al ingreso', async () => {
    sendJson.mockResolvedValue({ ok: false, status: 401, data: {} });
    render(<PlatformConsole initialReports={[report]} initialAccounts={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pasar a revisión' }));
    await userEvent.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: 'Confirmar', hidden: true }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/plataforma/login?e=expired'));
  });

  it('cuentas: ofrece suspender a una activa y reactivar a una suspendida; suspender exige motivo', async () => {
    postJson.mockResolvedValue({ ok: true, status: 200, data: { status: 'SUSPENDED' } });
    render(<PlatformConsole initialReports={[]} initialAccounts={[active, suspended]} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Cuentas' }));
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar', hidden: true }));
    expect(await within(dialog).findByText(/al menos 10 caracteres/)).toBeInTheDocument();
    expect(postJson).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox', { hidden: true }), 'Reporte de hostigamiento confirmado');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar', hidden: true }));
    await waitFor(() => expect(postJson).toHaveBeenCalledWith(`/api/plataforma/cuentas/${active.accountId}/status`, { status: 'SUSPENDED', reason: 'Reporte de hostigamiento confirmado' }));
  });
});
