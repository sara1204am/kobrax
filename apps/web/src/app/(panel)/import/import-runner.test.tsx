import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ImportConfig, PortfolioSummary } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { ImportRunner } from './import-runner';

const { refresh, capture } = vi.hoisted(() => ({
  refresh: vi.fn(),
  /**
   * Captura de lo que se manda al importar. En jsdom leer un cuerpo multipart desde msw se cuelga
   * (`formData()` y `text()`), así que para mirar el campo `assignments` se reemplaza la subida
   * entera —sólo mientras `on`—.
   */
  capture: { on: false, sent: [] as { dryRun?: boolean; assignments?: unknown }[], responses: [] as unknown[] },
}));
vi.mock('@/lib/import', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/import')>();
  return {
    ...mod,
    postImportFile: async (file: File, options: { dryRun?: boolean; assignments?: unknown } = {}) => {
      if (!capture.on) return mod.postImportFile(file, options as never);
      capture.sent.push(options);
      return { ok: true, data: capture.responses.shift() };
    },
  };
});
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
      <ImportRunner config={CONFIG} currency="BOB" assignees={[]} members={[]} />
    </ToastProvider>,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['%PDF'], 'Reporte_Mora_20260930_CQE.pdf', { type: 'application/pdf' }));
  await user.click(await screen.findByRole('button', { name: 'Confirmar e importar' }));
}

beforeEach(() => {
  refresh.mockClear();
  capture.on = false;
});

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
        <ImportRunner config={CONFIG} currency="BOB" assignees={[]} members={[]} />
      </ToastProvider>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['%PDF'], 'r.pdf', { type: 'application/pdf' }));
    await screen.findByRole('button', { name: 'Confirmar e importar' });
    expect(screen.queryByText(/Importación guardada/)).not.toBeInTheDocument();
  });
});

// ── Responsables al importar ─────────────────────────────────────────────────

const ME = '11111111-1111-1111-1111-111111111111';
const JUAN = '22222222-2222-2222-2222-222222222222';
const MARIA = '33333333-3333-3333-3333-333333333333';
const ASSIGNEES = [
  { userId: ME, name: 'Ana Gerente', roleName: 'MANAGER', isMe: true },
  { userId: JUAN, name: 'Juan Cobrador', roleName: 'COLLECTOR', isMe: false },
  { userId: MARIA, name: 'María Cobradora', roleName: 'COLLECTOR', isMe: false },
];
const MEMBERS = ASSIGNEES.map((a) => ({ id: a.userId, name: a.name, role: a.roleName }));

/** Vista previa con dos nuevos (uno sugerido a Juan, otro sin nadie) y un existente de María. */
function previewChoose(over: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return summary({
    dryRun: true,
    counts: { created: 2, updated: 1, setCurrent: 0, invalid: 0 },
    assignment: { mode: 'CHOOSE', selfUserId: ME },
    preview: {
      toCreate: [
        { code: '302-1', clientName: 'ROJAS ANA', suggestedAssigneeId: JUAN, suggestionSource: 'ADVISOR' },
        { code: '302-2', clientName: 'PAZ LUIS', suggestedAssigneeId: null },
      ],
      toUpdate: [{ code: '302-9', clientName: 'VEGA RITA', currentAssigneeId: MARIA }],
      toSetCurrent: [],
      toMarkAbsent: [],
      invalid: [],
      warnings: [],
    },
    ...over,
  });
}

/** Vista previa primero y corrida después; lo enviado al confirmar queda en `capture.sent[1]`. */
function apiCapturing(preview: PortfolioSummary) {
  capture.on = true;
  capture.sent = [];
  capture.responses = [preview, summary()];
  return {
    get assignments() {
      return capture.sent[1]?.assignments;
    },
  };
}

async function preview(p: PortfolioSummary) {
  const sent = apiCapturing(p);
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <ImportRunner config={CONFIG} currency="BOB" assignees={p.assignment?.mode === 'CHOOSE' ? ASSIGNEES : []} members={MEMBERS} />
    </ToastProvider>,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['%PDF'], 'r.pdf', { type: 'application/pdf' }));
  await screen.findByRole('button', { name: 'Confirmar e importar' });
  return { user, sent };
}

describe('ImportRunner — el cobrador importa su cartera (SELF)', () => {
  it('dice que lo nuevo es suyo y lo existente conserva su responsable, sin selectores ni casillas', async () => {
    await preview(
      summary({
        dryRun: true,
        assignment: { mode: 'SELF', selfUserId: ME },
        preview: {
          toCreate: [{ code: '302-1', clientName: 'ROJAS ANA', suggestedAssigneeId: ME, suggestionSource: 'SELF' }],
          toUpdate: [{ code: '302-9', clientName: 'VEGA RITA', currentAssigneeId: ME }],
          toSetCurrent: [],
          toMarkAbsent: [],
          invalid: [],
          warnings: [],
        },
      }),
    );
    expect(screen.getByText(/Estos créditos se asignarán a ti\./)).toBeInTheDocument();
    expect(screen.getByText(/Mantendrán su responsable actual\./)).toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Confirmar e importar' })).toBeEnabled();
  });
});

describe('ImportRunner — quien reparte (CHOOSE)', () => {
  it('🔴 con un nuevo sin responsable no deja confirmar, y dice por qué', async () => {
    await preview(previewChoose());
    expect(screen.getByRole('button', { name: 'Confirmar e importar' })).toBeDisabled();
    expect(screen.getByText(/Quedan 1 crédito nuevo sin responsable/)).toBeInTheDocument();
    expect(screen.getByText('Asignados 1 · Sin asignar 1')).toBeInTheDocument();
  });

  it('«asignar todos los sin asignar» completa el reparto y viaja agrupado por persona', async () => {
    const { user, sent } = await preview(previewChoose());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Asignar todos los sin asignar a…' }), MARIA);
    const confirm = screen.getByRole('button', { name: 'Confirmar e importar' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await screen.findByText(/Importación guardada/);
    expect(sent.assignments).toEqual({
      version: 1,
      create: [
        { userId: JUAN, externalIds: ['302-1'] },
        { userId: MARIA, externalIds: ['302-2'] },
      ],
      reassign: [],
    });
  });

  it('seleccionar y «Asignar a mí» le da los elegidos a quien importa', async () => {
    const { user, sent } = await preview(previewChoose());
    // La primera es la de «Nuevos»; la segunda, la de «Se actualizan».
    await user.click(screen.getAllByRole('checkbox', { name: 'Elegir todos los de esta página' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Asignar a mí' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar e importar' }));
    await screen.findByText(/Importación guardada/);
    expect(sent.assignments).toMatchObject({ create: [{ userId: ME, externalIds: ['302-1', '302-2'] }] });
  });

  it('reasignar un existente es explícito: se marca, pide confirmación y viaja con el responsable visto', async () => {
    const { user, sent } = await preview(previewChoose({ preview: { ...previewChoose().preview, toCreate: [] }, counts: { created: 0, updated: 1, setCurrent: 0, invalid: 0 } }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Nuevo responsable · 302-9' }), JUAN);
    expect(screen.getByText('Reasignación')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar e importar' }));
    expect(await screen.findByText(/Vas a cambiar el responsable de 1 crédito existente/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sí, reasignar e importar' }));
    await screen.findByText(/Importación guardada/);
    expect(sent.assignments).toMatchObject({ reassign: [{ externalId: '302-9', fromUserId: MARIA, toUserId: JUAN }] });
  });

  it('un archivo ya aplicado: avisa y no deja confirmar', async () => {
    await preview(previewChoose({ alreadyApplied: { runId: 'r1', at: '2026-09-30T20:52:00.000Z', by: 'Mónica Manager' } }));
    expect(screen.getByText(/Este archivo ya se importó/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar e importar' })).toBeDisabled();
  });
});
