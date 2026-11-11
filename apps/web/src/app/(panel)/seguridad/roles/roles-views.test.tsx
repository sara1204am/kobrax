import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Permission, PERMISSION_META, type PermissionCatalogEntry, type RoleCompare, type RoleDetail, type RoleHistoryPage, type RoleSummary } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { RolesTable } from './roles-table';
import { CompareView } from './comparar/compare-view';
import { HistoryList } from './[key]/history-list';
import { RoleActions } from './[key]/role-actions';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => '/seguridad/roles',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const catalog: PermissionCatalogEntry[] = Object.values(Permission).map((code) => ({
  code, module: code.split(':')[0]!, action: 'x', risk: PERMISSION_META[code].risk, reserved: PERMISSION_META[code].reserved ?? null,
  requires: [...(PERMISSION_META[code].requires ?? [])], name: code, description: null,
}));

const summary = (over: Partial<RoleSummary> = {}): RoleSummary => ({
  id: 'g1', name: 'MANAGER', level: 70, key: 'MANAGER', source: 'TEMPLATE', diverged: false, members: 3, permissions: 29, permissionsTotal: 45,
  scopeKind: 'SUBTREE', version: 1, updatedAt: '2026-11-04T10:00:00.000Z', editable: true, ...over,
});

const withPerms = (perms: string[], ui: React.ReactNode) => (
  <PermissionsProvider permissions={perms}>
    <ToastProvider>{ui}</ToastProvider>
  </PermissionsProvider>
);

describe('RolesTable — la lista de roles (vista A)', () => {
  it('una fila por rol con su nombre, origen, personas, alcance y permisos; el nombre lleva al detalle', () => {
    render(withPerms(['role:read'], <RolesTable roles={[summary(), summary({ key: 'COLLECTOR', name: 'COLLECTOR', scopeKind: 'OWN', members: 26, permissions: 17 })]} timezone="America/La_Paz" />));
    const link = screen.getByRole('link', { name: /Gerente/ });
    expect(link).toHaveAttribute('href', '/seguridad/roles/MANAGER');
    expect(screen.getByText('Lo propio')).toBeInTheDocument();
    expect(screen.getByText('29/45')).toBeInTheDocument();
    expect(screen.getByText('26')).toBeInTheDocument();
  });

  it('marca con ● el rol que difiere de la plantilla y lo dice como «Personalizado»', () => {
    render(withPerms(['role:read'], <RolesTable roles={[summary({ diverged: true })]} timezone={null} />));
    expect(screen.getByLabelText('Difiere de la plantilla')).toBeInTheDocument();
    expect(screen.getByText('Personalizado')).toBeInTheDocument();
  });

  it('el administrador se ve como «No editable»', () => {
    render(withPerms(['role:read'], <RolesTable roles={[summary({ key: 'ACCOUNT_ADMIN', name: 'ACCOUNT_ADMIN', editable: false })]} timezone={null} />));
    expect(screen.getByText('No editable')).toBeInTheDocument();
  });

  it('sin roles dice que la cuenta no tiene', () => {
    render(withPerms(['role:read'], <RolesTable roles={[]} timezone={null} />));
    expect(screen.getByText(/todavía no tiene roles/)).toBeInTheDocument();
  });
});

describe('RoleActions — editar y restaurar (sólo con role:write)', () => {
  const detail = (over: Partial<RoleDetail> = {}): RoleDetail => ({
    ...summary({ diverged: true, version: 5 }), templateKey: 'MANAGER', granted: ['client:read', 'client:write', 'data:scope:subtree'],
    diff: { added: ['client:write'], removed: ['report:read'] }, people: [], ...over,
  });

  it('🔴 sin role:write no se dibuja nada (ocultar no es autorizar, pero tampoco se ofrece)', () => {
    render(withPerms(['role:read'], <RoleActions role={detail()} catalog={catalog} roleName="Gerente" />));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('con role:write ofrece editar y, si difiere de la plantilla, restaurarla', () => {
    render(withPerms(['role:read', 'role:write'], <RoleActions role={detail()} catalog={catalog} roleName="Gerente" />));
    expect(screen.getByRole('link', { name: 'Editar permisos' })).toHaveAttribute('href', '/seguridad/roles/MANAGER/editar');
    expect(screen.getByRole('button', { name: 'Restaurar plantilla' })).toBeInTheDocument();
  });

  it('un rol que no difiere no ofrece restaurar', () => {
    render(withPerms(['role:write'], <RoleActions role={detail({ diverged: false, diff: { added: [], removed: [] } })} catalog={catalog} roleName="Gerente" />));
    expect(screen.queryByRole('button', { name: 'Restaurar plantilla' })).not.toBeInTheDocument();
  });

  it('el administrador no se edita: se explica', () => {
    render(withPerms(['role:write'], <RoleActions role={detail({ editable: false })} catalog={catalog} roleName="Administrador" />));
    expect(screen.getByText('Este rol no se puede editar.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar permisos' })).not.toBeInTheDocument();
  });

  it('🔴 restaurar pide motivo y manda la versión; al terminar refresca', async () => {
    let sent: unknown = null;
    server.use(http.post('*/api/roles/MANAGER/restore-template', async ({ request }) => ((sent = await request.json()), HttpResponse.json({ role: detail({ diverged: false }), affectedMembers: 3 }))));
    render(withPerms(['role:write'], <RoleActions role={detail()} catalog={catalog} roleName="Gerente" />));
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar plantilla' }));
    await userEvent.type(screen.getByLabelText('Motivo (obligatorio)'), 'Volver a lo estándar');
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    expect(sent).toEqual({ expectedVersion: 5, reason: 'Volver a lo estándar' });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('HistoryList — el historial de un rol (vista E)', () => {
  const entry = (id: string, over: Partial<RoleHistoryPage['items'][number]> = {}): RoleHistoryPage['items'][number] => ({
    id, at: '2026-11-04T10:12:00.000Z', actorType: 'USER', actorName: 'Ana Pérez', action: 'ROLE_PERMISSIONS_UPDATED', added: ['client:delete'], removed: ['report:export'], reason: 'Pedido de gerencia', ...over,
  });

  it('cada cambio dice quién, qué se añadió o quitó y por qué', () => {
    render(<HistoryList roleKey="MANAGER" initial={{ items: [entry('1')], nextCursor: null }} timezone="America/La_Paz" />);
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(screen.getByText(/Eliminar clientes/)).toBeInTheDocument();
    expect(screen.getByText(/Exportar reportes/)).toBeInTheDocument();
    expect(screen.getByText('Motivo: Pedido de gerencia')).toBeInTheDocument();
  });

  it('un cambio de plataforma se marca como «Plataforma»', () => {
    render(<HistoryList roleKey="MANAGER" initial={{ items: [entry('1', { actorType: 'PLATFORM', actorName: null })], nextCursor: null }} timezone={null} />);
    expect(screen.getByText(/Plataforma/)).toBeInTheDocument();
  });

  it('sin cambios dice que el rol todavía no tiene', () => {
    render(<HistoryList roleKey="MANAGER" initial={{ items: [], nextCursor: null }} timezone={null} />);
    expect(screen.getByText('Este rol todavía no tiene cambios.')).toBeInTheDocument();
  });

  it('«Ver más» pide la página siguiente con el cursor y la suma', async () => {
    let cursor: string | null = null;
    server.use(http.get('*/api/roles/MANAGER/history', ({ request }) => ((cursor = new URL(request.url).searchParams.get('cursor')), HttpResponse.json({ items: [entry('2', { actorName: 'Luis Rojas' })], nextCursor: null }))));
    render(<HistoryList roleKey="MANAGER" initial={{ items: [entry('1')], nextCursor: 'c1' }} timezone={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    expect(await screen.findByText(/Luis Rojas/)).toBeInTheDocument();
    expect(cursor).toBe('c1');
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument();
  });
});

describe('CompareView — comparar dos roles (vista D)', () => {
  const compare: RoleCompare = {
    a: summary({ key: 'MANAGER', name: 'MANAGER', scopeKind: 'SUBTREE' }),
    b: summary({ key: 'SUPERVISOR', name: 'SUPERVISOR', scopeKind: 'BRANCH' }),
    rows: [
      { code: 'client:read', a: true, b: true },
      { code: 'client:pii:read', a: true, b: false },
    ],
  };

  it('sin elegir los dos pide elegirlos', () => {
    render(<CompareView roles={[{ key: 'MANAGER' }, { key: 'SUPERVISOR' }]} compare={null} />);
    expect(screen.getByText('Elige dos roles para compararlos.')).toBeInTheDocument();
  });

  it('por omisión muestra sólo las diferencias y dice de quién es cada una; los alcances se comparan', async () => {
    render(<CompareView roles={[{ key: 'MANAGER' }, { key: 'SUPERVISOR' }]} a="MANAGER" b="SUPERVISOR" compare={compare} />);
    expect(screen.getByText('Ver documentos en claro')).toBeInTheDocument();
    expect(screen.getByText('Solo Gerente')).toBeInTheDocument();
    expect(screen.queryByText('Ver clientes')).not.toBeInTheDocument();
    expect(screen.getByText(/Sus oficinas y las de abajo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mostrar solo las diferencias' }));
    expect(screen.getByText('Ver clientes')).toBeInTheDocument();
  });

  it('elegir otro rol escribe la URL para poder compartirla', async () => {
    render(<CompareView roles={[{ key: 'MANAGER' }, { key: 'SUPERVISOR' }, { key: 'COLLECTOR' }]} a="MANAGER" b="SUPERVISOR" compare={compare} />);
    await userEvent.selectOptions(screen.getByLabelText('B'), 'COLLECTOR');
    expect(push).toHaveBeenCalledWith('/seguridad/roles/comparar?a=MANAGER&b=COLLECTOR');
  });
});
