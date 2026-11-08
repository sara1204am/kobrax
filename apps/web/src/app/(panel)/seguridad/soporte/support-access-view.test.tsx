import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { SupportAccessView, type SupportSessionRow } from './support-access-view';

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const row = (over: Partial<SupportSessionRow> = {}): SupportSessionRow => ({
  id: 'ss-1',
  reason: 'Corregir el nombre de una oficina',
  ticket: 'T-321',
  permissions: ['client:read'],
  sensitive: true,
  consentStatus: 'PENDING',
  expiresAt: FUTURE,
  createdAt: new Date().toISOString(),
  status: 'AWAITING_CONSENT',
  ...over,
});

describe('SupportAccessView — accesos de soporte (F14 · F5)', () => {
  it('sin accesos dice que nadie del equipo de Kobrax pidió entrar', () => {
    render(<SupportAccessView initial={[]} timezone="America/La_Paz" />);
    expect(screen.getByText('Nadie del equipo de Kobrax ha pedido acceso a tu cuenta.')).toBeInTheDocument();
  });

  it('🔴 un acceso que pide escribir espera la aceptación: se explica y se puede aceptar, rechazar o cortar', () => {
    render(<SupportAccessView initial={[row()]} timezone={null} />);
    expect(screen.getByText('Espera tu aceptación')).toBeInTheDocument();
    expect(screen.getByText(/Sin tu aceptación solo pueden ver/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cortar acceso' })).toBeInTheDocument();
  });

  it('aceptar manda la acción a la API y deja el acceso vigente (ya sin botones de aceptar)', async () => {
    let called = '';
    server.use(
      http.post('*/api/support-access/ss-1/grant', () => {
        called = 'grant';
        return HttpResponse.json({ ...row(), consentStatus: 'GRANTED', status: 'ACTIVE' });
      }),
    );
    render(<SupportAccessView initial={[row()]} timezone={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByText('Vigente')).toBeInTheDocument();
    expect(called).toBe('grant');
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cortar acceso' })).toBeInTheDocument(); // cortar sigue disponible
  });

  it('🔴 cortar un acceso lo deja revocado y sin acciones; un acceso solo de lectura no pide aceptación', async () => {
    server.use(http.post('*/api/support-access/ss-2/revoke', () => HttpResponse.json({ ...row({ id: 'ss-2', sensitive: false, consentStatus: 'NOT_REQUIRED', status: 'ACTIVE' }), status: 'REVOKED' })));
    render(<SupportAccessView initial={[row({ id: 'ss-2', sensitive: false, consentStatus: 'NOT_REQUIRED', status: 'ACTIVE' })]} timezone={null} />);
    expect(screen.getByText('Solo ver')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cortar acceso' }));
    expect(await screen.findByText('Revocado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cortar acceso' })).not.toBeInTheDocument();
  });

  it('si la API rechaza la acción lo dice, sin cambiar el estado', async () => {
    server.use(http.post('*/api/support-access/ss-1/grant', () => HttpResponse.json({ error: { code: 'SUPPORT_004', message: 'La sesión de soporte ya no está vigente' } }, { status: 409 })));
    render(<SupportAccessView initial={[row()]} timezone={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La sesión de soporte ya no está vigente');
    expect(screen.getByText('Espera tu aceptación')).toBeInTheDocument();
  });
});
