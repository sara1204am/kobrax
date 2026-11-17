import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyWorkspace, type AccountInfo, type Workspace } from '@kobrax/shared';
import { ToastProvider } from '@/components/toast';
import { WorkspaceEditor } from './workspace-editor';

const { sendJson, refresh } = vi.hoisted(() => ({ sendJson: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/client', () => ({ sendJson }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const account = (
  workspace?: Workspace,
  usage: { users: number; branches: number } = { users: 1, branches: 1 },
): AccountInfo =>
  ({
    id: 'a1',
    workspace,
    usage: { ...usage, credits: 0, clients: 0, photosPerMonth: 0, actionsPerMonth: 0 },
  }) as unknown as AccountInfo;

function draw(acc: AccountInfo = account()) {
  return render(
    <ToastProvider>
      <WorkspaceEditor account={acc} />
    </ToastProvider>,
  );
}

const sw = (name: string) => screen.getByRole('switch', { name });
const guardar = () => screen.getByRole('button', { name: 'Guardar cambios' });
const saved = (w: Partial<Workspace>) => ({
  ok: true,
  data: { workspace: { ...emptyWorkspace(), ...w } },
});

beforeEach(() => {
  sendJson.mockReset();
  refresh.mockReset();
});

describe('WorkspaceEditor (F15 · P4)', () => {
  it('🔴 A-1: una cuenta que nunca lo configuró lo ve todo y no hay nada que guardar', () => {
    draw();
    for (const m of [
      'Rutas de visitas',
      'Importar cartera',
      'Exportar y reportes',
      'Equipo',
      'Oficinas',
    ])
      expect(sw(m)).toBeChecked();
    expect(screen.getByText(/14 de 14 ítems en el menú/)).toBeInTheDocument();
    expect(guardar()).toBeDisabled();
  });

  it('tiene las mismas secciones que el asistente y ya no ofrece «Punto de partida»', () => {
    draw();
    for (const h of ['Tus herramientas', 'La ficha de tus clientes', 'Tus créditos'])
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    expect(screen.queryByText('Punto de partida')).toBeNull();
    expect(screen.getByRole('radio', { name: /Cuota acordada/ })).toBeInTheDocument();
  });

  it('elegir una modalidad de crédito habilita guardar', async () => {
    draw();
    await userEvent.click(screen.getByRole('radio', { name: /Cuota acordada/ }));
    expect(guardar()).toBeEnabled();
  });

  it('🔴 guarda UN documento con el rev leído y solo lo que se oculta (A-16)', async () => {
    sendJson.mockResolvedValue(
      saved({ rev: 4, hiddenModules: ['routes'], options: { 'client.income': false } }),
    );
    draw(account({ ...emptyWorkspace(), rev: 3 }));
    await userEvent.click(sw('Rutas de visitas'));
    await userEvent.click(sw('Ingresos'));
    await userEvent.click(guardar());
    expect(sendJson).toHaveBeenCalledWith(
      '/api/account/me',
      {
        workspace: {
          version: 1,
          rev: 3,
          hiddenModules: ['routes'],
          options: { 'client.income': false },
        },
      },
      'PATCH',
    );
  });

  it('tras guardar refresca el panel (menú y avisos leen el workspace del layout) y no queda nada pendiente', async () => {
    sendJson.mockResolvedValue(saved({ rev: 1, hiddenModules: ['export'] }));
    draw();
    await userEvent.click(sw('Exportar y reportes'));
    await userEvent.click(guardar());
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByText(/Sin cambios/)).toBeInTheDocument();
    expect(guardar()).toBeDisabled();
  });

  it('«Restablecer a Completo» vuelve a mostrar todo (se guarda con el botón)', async () => {
    draw(account({ ...emptyWorkspace(), rev: 2, hiddenModules: ['routes', 'export'] }));
    expect(sw('Rutas de visitas')).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer a Completo' }));
    expect(sw('Rutas de visitas')).toBeChecked();
    expect(guardar()).toBeEnabled();
  });

  it('🔴 S-1/S-2/S-7 anticipadas: con varias personas u oficinas esos módulos no se pueden apagar', () => {
    draw(account(undefined, { users: 3, branches: 2 }));
    for (const m of ['Equipo', 'Oficinas']) expect(sw(m)).toBeDisabled();
    expect(sw('Rutas de visitas')).toBeEnabled();
    expect(screen.getAllByText(/Tu cuenta tiene 3 personas/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tu cuenta tiene 2 oficinas activas/).length).toBeGreaterThan(0);
  });

  it('volver a mostrar un módulo ya oculto nunca se bloquea, aunque hoy haya varias personas', () => {
    draw(
      account({ ...emptyWorkspace(), rev: 1, hiddenModules: ['team'] }, { users: 4, branches: 1 }),
    );
    expect(sw('Equipo')).toBeEnabled();
    expect(sw('Equipo')).not.toBeChecked();
  });

  it('🔴 un conflicto de rev avisa y ofrece recargar; nada se pisa', async () => {
    sendJson.mockResolvedValue({
      ok: false,
      data: { error: { code: 'WORKSPACE_CONFLICT', details: { reason: 'REV', currentRev: 5 } } },
    });
    draw();
    await userEvent.click(sw('Rutas de visitas'));
    await userEvent.click(guardar());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cambió mientras lo editabas');
    await userEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('un documento de una versión más nueva se explica y NO ofrece recargar (no se arregla recargando)', async () => {
    sendJson.mockResolvedValue({
      ok: false,
      data: {
        error: { code: 'WORKSPACE_CONFLICT', details: { reason: 'VERSION', storedVersion: 2 } },
      },
    });
    draw();
    await userEvent.click(sw('Rutas de visitas'));
    await userEvent.click(guardar());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('versión más nueva');
    expect(within(alert).queryByRole('button', { name: 'Recargar' })).not.toBeInTheDocument();
  });

  it('un bloqueo del servidor lista qué módulos y por qué, con los conteos', async () => {
    sendJson.mockResolvedValue({
      ok: false,
      data: {
        error: {
          code: 'WORKSPACE_BLOCKED',
          details: {
            blocks: [
              { module: 'routes', reason: 'ROUTES_IN_PROGRESS', count: 2 },
              { module: 'team', reason: 'MEMBERS', count: 3 },
            ],
          },
        },
      },
    });
    draw();
    await userEvent.click(sw('Rutas de visitas'));
    await userEvent.click(guardar());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Rutas: hay 2 rutas en curso.');
    expect(alert).toHaveTextContent('Equipo: tu cuenta tiene 3 personas.');
  });

  it('una configuración inválida y un error cualquiera se dicen sin romper la pantalla', async () => {
    sendJson.mockResolvedValue({ ok: false, data: { error: { code: 'WORKSPACE_INVALID' } } });
    draw();
    await userEvent.click(sw('Rutas de visitas'));
    await userEvent.click(guardar());
    expect(await screen.findByRole('alert')).toHaveTextContent('no es válida');
  });

  it('las frecuencias: siempre queda al menos una, y todas marcadas = sin restricción', async () => {
    draw(account({ ...emptyWorkspace(), rev: 1, options: { 'credit.frequencies': ['MONTHLY'] } }));
    const mensual = screen.getByRole('checkbox', { name: 'Mensual' });
    expect(mensual).toBeChecked();
    // La última no se puede quitar: el control se ve bloqueado (no «no hace nada»).
    expect(mensual).toBeDisabled();
    expect(mensual).toBeChecked();
    for (const f of ['Diario', 'Semanal', 'Quincenal'])
      await userEvent.click(screen.getByRole('checkbox', { name: f }));
    // Con las cuatro marcadas la opción desaparece: coincide con lo que ya guardaba (sin restricción) → es un cambio respecto de ['MONTHLY'].
    sendJson.mockResolvedValue(saved({ rev: 2 }));
    await userEvent.click(guardar());
    expect(sendJson).toHaveBeenCalledWith(
      '/api/account/me',
      { workspace: { version: 1, rev: 1, hiddenModules: [], options: {} } },
      'PATCH',
    );
  });

  it('siempre dice que ocultar no cambia permisos ni datos', () => {
    draw();
    expect(screen.getByText(/ocultar no es autorizar/)).toBeInTheDocument();
    expect(screen.getAllByText(/Nada se borra/).length).toBeGreaterThan(0);
  });
});

describe('WorkspaceEditor · topes del plan (F15)', () => {
  const free = (workspace?: Workspace) =>
    ({
      ...account(workspace),
      planCode: 'FREE',
      limits: { users: 1, branches: 1 },
    }) as unknown as AccountInfo;

  it('🔴 con un solo asiento y una oficina, Equipo, Actividad y Organización no se ofrecen', () => {
    draw(free());
    for (const m of ['Equipo', 'Oficinas']) {
      expect(screen.queryByRole('switch', { name: m })).toBeNull();
    }
    expect(sw('Rutas de visitas')).toBeInTheDocument();
  });

  it('🔴 guardar siempre manda Equipo, Actividad y Organización ocultos, aunque la cuenta los tuviera visibles', async () => {
    sendJson.mockResolvedValue(saved({ rev: 1, hiddenModules: ['export'] }));
    draw(free());
    await userEvent.click(sw('Exportar y reportes'));
    await userEvent.click(guardar());
    const body = sendJson.mock.calls[0]![1];
    expect([...body.workspace.hiddenModules].sort()).toEqual([
      'activity',
      'export',
      'organization',
      'team',
    ]);
  });

  it('«Restablecer a Completo» tampoco los muestra en una cuenta individual', async () => {
    sendJson.mockResolvedValue(saved({ rev: 1 }));
    draw(free({ ...emptyWorkspace(), rev: 2, hiddenModules: ['export'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer a Completo' }));
    await userEvent.click(guardar());
    expect([...sendJson.mock.calls[0]![1].workspace.hiddenModules].sort()).toEqual([
      'activity',
      'organization',
      'team',
    ]);
  });

  it('si el servidor responde que el plan no lo permite, lo explica', async () => {
    sendJson.mockResolvedValue({ ok: false, data: { error: { code: 'WORKSPACE_PLAN_GATED' } } });
    draw(free());
    await userEvent.click(sw('Rutas de visitas'));
    await userEvent.click(guardar());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Tu plan no incluye Equipo ni Oficinas/,
    );
  });

  it('un plan para varias personas sí muestra Equipo', () => {
    draw({
      ...account(),
      planCode: 'PROFESSIONAL',
      limits: { users: 25, branches: 3 },
    } as unknown as AccountInfo);
    expect(sw('Equipo')).toBeInTheDocument();
    expect(sw('Oficinas')).toBeInTheDocument();
  });
});
