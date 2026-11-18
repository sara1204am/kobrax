import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicReportForm } from './public-report-form';

const postJson = vi.fn();
vi.mock('@/lib/client', () => ({ postJson: (...a: unknown[]) => postJson(...a) }));

describe('PublicReportForm', () => {
  beforeEach(() => postJson.mockReset());

  it('no deja enviar sin correo válido ni descripción de al menos 10 caracteres', async () => {
    render(<PublicReportForm mode="report" />);
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Tu correo/), 'persona@ejemplo.com');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Cuéntanos qué pasó/), 'Me llaman a toda hora');
    expect(send).toBeEnabled();
  });

  it('envía el tipo elegido, con la trampa vacía, y muestra el código de seguimiento', async () => {
    postJson.mockResolvedValue({ ok: true, data: { reference: 'ABCDEF12' } });
    render(<PublicReportForm mode="report" />);
    await userEvent.type(screen.getByLabelText(/Tu correo/), 'persona@ejemplo.com');
    await userEvent.type(screen.getByLabelText(/Cuéntanos qué pasó/), 'Me llaman a toda hora');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());
    const [path, body] = postJson.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/public/reports');
    expect(body).toMatchObject({ type: 'ABUSE_REPORT', contactEmail: 'persona@ejemplo.com', website: '' });
  });

  it('en modo eliminación el tipo va fijo y basta el correo (la descripción es opcional)', async () => {
    postJson.mockResolvedValue({ ok: true, data: { reference: 'ZZZZ0000' } });
    render(<PublicReportForm mode="deletion" />);
    expect(screen.queryByLabelText('¿Qué necesitas?')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Tu correo/), 'persona@ejemplo.com');
    await userEvent.click(screen.getByRole('button', { name: 'Pedir la eliminación' }));
    await waitFor(() => expect(postJson).toHaveBeenCalled());
    expect(postJson.mock.calls[0]![1]).toMatchObject({ type: 'ACCOUNT_DELETION', description: 'Solicito eliminar mi cuenta de Kobrax y mis datos de usuario.' });
  });

  it('muestra el error del servidor y no pasa a «enviado»', async () => {
    postJson.mockResolvedValue({ ok: false, data: { error: { message: 'Ya tienes varias solicitudes abiertas.' } } });
    render(<PublicReportForm mode="report" />);
    await userEvent.type(screen.getByLabelText(/Tu correo/), 'persona@ejemplo.com');
    await userEvent.type(screen.getByLabelText(/Cuéntanos qué pasó/), 'Me llaman a toda hora');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Ya tienes varias solicitudes abiertas.')).toBeInTheDocument();
    expect(screen.queryByText('Recibimos tu mensaje')).not.toBeInTheDocument();
  });
});
