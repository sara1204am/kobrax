import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { LatePolicyInfo } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { LatePolicyForm } from './late-policy-form';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const OFF: LatePolicyInfo = { kind: 'NONE', annualRate: null, dayCount: null, graceDays: 0, capPctOfPrincipal: null, version: 1, effectiveFrom: '2026-11-21T00:00:00.000Z', createdByName: null };
const ON: LatePolicyInfo = { kind: 'ANNUAL_RATE', annualRate: 18, dayCount: 360, graceDays: 2, capPctOfPrincipal: 30, version: 2, effectiveFrom: '2026-11-22T00:00:00.000Z', createdByName: 'Ana Paz' };

function renderIt(policy: LatePolicyInfo, permissions = ['account:read', 'account:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <LatePolicyForm policy={policy} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

function capture(sink: unknown[]) {
  return http.put('*/api/account/late-policy', async ({ request }) => {
    sink.push(await request.json());
    return HttpResponse.json(ON);
  });
}

beforeEach(() => refresh.mockClear());

describe('LatePolicyForm — interés moratorio apagado por defecto', () => {
  it('una cuenta nueva lo ve APAGADO, sin campos de tasa y con el aviso de que no es retroactivo', () => {
    renderIt(OFF);
    expect(screen.getByRole('switch', { name: 'Cobrar interés moratorio' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText(/Tasa anual/)).not.toBeInTheDocument();
    expect(screen.getByText(/Solo se aplica a los créditos que se creen después/)).toBeInTheDocument();
    expect(screen.getByText(/Sin cargos por mora/)).toBeInTheDocument();
  });

  it('sin tocar nada, guardar está apagado', () => {
    renderIt(OFF);
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('activarlo muestra los parámetros y NO deja guardar sin tasa', async () => {
    renderIt(OFF);
    await userEvent.click(screen.getByRole('switch', { name: 'Cobrar interés moratorio' }));
    expect(screen.getByLabelText(/Tasa anual/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(screen.getByText('Escribe la tasa anual.')).toBeInTheDocument();
  });

  it('rechaza una tasa fuera de rango antes de enviar (un 180 por 18)', async () => {
    renderIt(OFF);
    await userEvent.click(screen.getByRole('switch', { name: 'Cobrar interés moratorio' }));
    await userEvent.type(screen.getByLabelText(/Tasa anual/), '180');
    expect(screen.getByText(/no pasar de 100 %/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('envía la política con coma decimal, base 365 por defecto y gracia 0', async () => {
    const enviados: unknown[] = [];
    server.use(capture(enviados));
    renderIt(OFF);

    await userEvent.click(screen.getByRole('switch', { name: 'Cobrar interés moratorio' }));
    await userEvent.type(screen.getByLabelText(/Tasa anual/), '12,5');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviados).toEqual([{ kind: 'ANNUAL_RATE', annualRate: 12.5, dayCount: 365, graceDays: 0 }]);
    expect(refresh).toHaveBeenCalled();
  });

  it('apagarlo manda «sin cargos» sin ningún parámetro', async () => {
    const enviados: unknown[] = [];
    server.use(capture(enviados));
    renderIt(ON);

    expect(screen.getByLabelText(/Tasa anual/)).toHaveValue('18');
    expect(screen.getByText(/Versión 2 · vigente desde .* · Ana Paz/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Cobrar interés moratorio' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(enviados).toEqual([{ kind: 'NONE' }]);
  });

  it('sin permiso de escritura todo queda de solo lectura y no hay botón de guardar', () => {
    renderIt(ON, ['account:read']);
    expect(screen.getByRole('switch', { name: 'Cobrar interés moratorio' })).toBeDisabled();
    expect(screen.getByLabelText(/Tasa anual/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.getByText('Solo un administrador puede cambiar esta política.')).toBeInTheDocument();
  });
});
