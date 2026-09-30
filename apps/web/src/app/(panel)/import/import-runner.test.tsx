import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ImportConfig, PortfolioSummary } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { ImportRunner } from './import-runner';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
// La vista previa dibuja `DataTable`, que lee la URL: sin estos dos el render revienta.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/import',
  useSearchParams: () => new URLSearchParams(),
}));

const CONFIG = {
  source: 'file',
  profile: { kind: 'pdf-rows' },
  fields: { code: { from: 'No. de Oper.' } },
  nameOrder: 'full',
  scope: { kind: 'account', ref: null },
  absentRule: 'set-current',
  carriesAssignee: false,
  askOnLogin: true,
} as unknown as ImportConfig;

function summary(over: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    dryRun: false,
    idempotentSkip: false,
    counts: { created: 5, updated: 11, setCurrent: 2, invalid: 0, absent: 2 },
    preview: { toCreate: [], toUpdate: [], toSetCurrent: [], toMarkAbsent: [], invalid: [], warnings: [] },
    ...over,
  } as PortfolioSummary;
}

/**
 * La API: la primera llamada es la vista previa y la segunda la corrida real. Que `dryRun` viaje en
 * el formulario ya lo afirma el test de `postImportFile`; acá importa el orden.
 */
function api(real: PortfolioSummary) {
  let calls = 0;
  server.use(
    http.post('http://localhost/api/imports/run', () => HttpResponse.json(calls++ === 0 ? summary({ dryRun: true }) : real)),
  );
}

async function importFile() {
  const user = userEvent.setup();
  const { container } = render(
    <ToastProvider>
      <ImportRunner config={CONFIG} currency="BOB" />
    </ToastProvider>,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['%PDF'], 'Reporte_Mora_20260930_CQE.pdf', { type: 'application/pdf' }));
  await user.click(await screen.findByRole('button', { name: 'Confirmar e importar' }));
}

beforeEach(() => refresh.mockClear());

describe('ImportRunner — aviso al guardar', () => {
  it('🔴 al confirmar avisa que quedó guardado, con cuántos nuevos y actualizados', async () => {
    api(summary());
    await importFile();
    expect(await screen.findByText('Importación guardada: 5 nuevos y 11 actualizados.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('con filas rechazadas avisa que se guardó, pero no todo', async () => {
    api(summary({ counts: { created: 5, updated: 11, setCurrent: 0, invalid: 3 } }));
    await importFile();
    expect(await screen.findByText('Importación guardada, con 3 registros rechazados.')).toBeInTheDocument();
  });

  it('el mismo archivo otra vez no guardó nada, y lo dice', async () => {
    api(summary({ idempotentSkip: true }));
    await importFile();
    expect(await screen.findByText('Este archivo ya se había importado: no se volvió a aplicar.')).toBeInTheDocument();
  });

  it('la vista previa no avisa nada: todavía no se guardó', async () => {
    api(summary());
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ImportRunner config={CONFIG} currency="BOB" />
      </ToastProvider>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['%PDF'], 'r.pdf', { type: 'application/pdf' }));
    await screen.findByRole('button', { name: 'Confirmar e importar' });
    expect(screen.queryByText(/Importación guardada/)).not.toBeInTheDocument();
  });
});
