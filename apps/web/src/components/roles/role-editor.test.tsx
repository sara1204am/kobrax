import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Permission, PERMISSION_META, type PermissionCatalogEntry, type RoleDetail } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { RoleEditor } from './role-editor';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }), usePathname: () => '/seguridad/roles/MANAGER/editar' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const catalog: PermissionCatalogEntry[] = Object.values(Permission).map((code) => ({
  code,
  module: code.split(':')[0]!,
  action: 'x',
  risk: PERMISSION_META[code].risk,
  reserved: PERMISSION_META[code].reserved ?? null,
  requires: [...(PERMISSION_META[code].requires ?? [])],
  name: code,
  description: null,
}));

const role = (over: Partial<RoleDetail> = {}): RoleDetail => ({
  id: 'g-mgr', name: 'MANAGER', level: 70, key: 'MANAGER', source: 'TEMPLATE', diverged: false, members: 3, permissions: 2, permissionsTotal: 45,
  scopeKind: 'SUBTREE', version: 3, updatedAt: '2026-11-08T10:00:00.000Z', editable: true,
  templateKey: 'MANAGER', granted: ['client:read', 'data:scope:subtree'], diff: { added: [], removed: [] }, people: [], ...over,
});

const renderEditor = (r: RoleDetail = role(), selfInRole = false) =>
  render(
    <ToastProvider>
      <RoleEditor role={r} catalog={catalog} roleName="Gerente" selfInRole={selfInRole} />
    </ToastProvider>,
  );

const row = (code: string) => document.querySelector(`[data-code="${code}"]`) as HTMLElement;
const checkbox = (code: string) => within(row(code)).getByRole('checkbox') as HTMLInputElement;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});

describe('RoleEditor — editar los permisos de un rol (F14 · F7)', () => {
  it('muestra el alcance de datos actual y los permisos agrupados por módulo, con los concedidos marcados', () => {
    renderEditor();
    expect(screen.getByRole('radio', { name: /Sus oficinas y las de abajo/ })).toBeChecked();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(checkbox('client:read')).toBeChecked();
    expect(checkbox('client:write')).not.toBeChecked();
    expect(screen.getByText('Sin cambios')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('🔴 los permisos reservados salen con candado y no se pueden marcar', () => {
    renderEditor();
    expect(checkbox('role:write')).toBeDisabled();
    expect(within(row('role:write')).getByText(/Reservado: solo el administrador/)).toBeInTheDocument();
  });

  it('marcar un permiso que depende de otro marca la dependencia y lo avisa', async () => {
    renderEditor(role({ granted: ['data:scope:subtree'] }));
    await userEvent.click(checkbox('client:write'));
    expect(checkbox('client:write')).toBeChecked();
    expect(checkbox('client:read')).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('También se marcó lo que necesita: Ver clientes.');
    expect(screen.getByText('2 cambios')).toBeInTheDocument();
  });

  it('desmarcar un permiso desmarca lo que dependía de él y lo avisa', async () => {
    renderEditor(role({ granted: ['client:read', 'client:write', 'data:scope:subtree'] }));
    await userEvent.click(checkbox('client:read'));
    expect(checkbox('client:write')).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('También se quitó lo que dependía de él: Editar clientes.');
  });

  it('el alcance de datos es uno solo: elegir otro reemplaza al anterior y cuenta como cambio', async () => {
    renderEditor();
    await userEvent.click(screen.getByRole('radio', { name: /Toda la cuenta/ }));
    expect(screen.getByRole('radio', { name: /Toda la cuenta/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Sus oficinas y las de abajo/ })).not.toBeChecked();
    expect(screen.getByText('2 cambios')).toBeInTheDocument();
  });

  it('cuenta el riesgo alto añadido en la barra', async () => {
    renderEditor();
    await userEvent.click(checkbox('client:delete'));
    expect(screen.getByText(/1 de riesgo alto/)).toBeInTheDocument();
  });

  it('quien pertenece al rol sólo puede quitar: no puede marcar los que faltan', () => {
    renderEditor(role(), true);
    expect(screen.getByText(/solo puedes quitarle permisos/)).toBeInTheDocument();
    expect(checkbox('client:write')).toBeDisabled();
    expect(checkbox('client:read')).not.toBeDisabled();
  });

  it('🔴 guardar pide confirmar con motivo; sin motivo no se manda; con motivo manda el conjunto completo y la versión', async () => {
    let sent: unknown = null;
    server.use(
      http.put('*/api/roles/MANAGER/permissions', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ role: role({ version: 4 }), affectedMembers: 3 });
      }),
    );
    renderEditor();
    await userEvent.click(checkbox('client:write'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver cambios' }));

    expect(screen.getByText(/Afecta a 3 personas/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirmar cambios' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Motivo (obligatorio)'), 'Necesitan editar');
    await userEvent.click(confirm);

    expect(sent).toEqual({ permissions: ['client:read', 'client:write', 'data:scope:subtree'], expectedVersion: 3, reason: 'Necesitan editar' });
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/seguridad/roles/MANAGER'));
  });

  it('🔴 si el servidor rechaza, el diálogo NO se cierra, muestra por qué y resalta los permisos implicados', async () => {
    server.use(
      http.put('*/api/roles/MANAGER/permissions', () =>
        HttpResponse.json({ error: { code: 'ROLE_DEPENDENCY', message: 'Faltan permisos de los que otros dependen', details: { violations: [{ code: 'ROLE_DEPENDENCY', permissions: ['client:write'] }] } } }, { status: 422 }),
      ),
    );
    renderEditor();
    await userEvent.click(checkbox('client:write'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver cambios' }));
    await userEvent.type(screen.getByLabelText('Motivo (obligatorio)'), 'Probando el rechazo');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan permisos de los que otros dependen');
    expect(push).not.toHaveBeenCalled();
    expect(row('client:write').className).toContain('border-k-danger');
  });

  it('una edición simultánea (409) ofrece recargar', async () => {
    server.use(http.put('*/api/roles/MANAGER/permissions', () => HttpResponse.json({ error: { code: 'ROLE_VERSION_CONFLICT', message: 'Otra persona cambió este rol mientras lo editabas. Recarga para ver los cambios.' } }, { status: 409 })));
    renderEditor();
    await userEvent.click(checkbox('report:read'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver cambios' }));
    await userEvent.type(screen.getByLabelText('Motivo (obligatorio)'), 'Con versión vieja');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cambios' }));
    expect(await screen.findByRole('button', { name: 'Recargar' })).toBeInTheDocument();
  });
});
