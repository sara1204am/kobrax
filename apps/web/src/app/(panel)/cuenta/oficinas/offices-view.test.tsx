import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Member } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import type { OfficeRow, OfficeType } from '@/lib/offices';
import { OfficesView } from './offices-view';
import { SingleOffice } from './single-office';

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));

function office(id: string, name: string, parent: OfficeRow | null, extra: Partial<OfficeRow> = {}): OfficeRow {
  return {
    id,
    name,
    code: null,
    city: null,
    address: null,
    active: true,
    parentId: parent?.id ?? null,
    typeId: 't1',
    typeName: parent ? 'Agencia' : 'Central',
    path: `${parent?.path ?? '/'}${id}/`,
    depth: parent ? parent.depth + 1 : 0,
    isRoot: !parent,
    fullName: parent ? `${parent.fullName} › ${name}` : name,
    managerUserId: null,
    members: 0,
    credits: 0,
    ...extra,
  };
}

const central = office('c', 'Central', null);
const lp = office('lp', 'La Paz', central);
const ch = office('ch', 'Chuquisaca', central);
const mv = office('mv', 'Mesa Verde', ch, { code: 'MV', credits: 12, members: 3 });
const chc = office('cc', 'Central', ch);
const ROWS = [central, lp, ch, mv, chc];
const TYPES: OfficeType[] = [{ id: 't1', code: 'AGENCY', name: 'Agencia', sortOrder: 1, isActive: true }];
const MEMBERS: Member[] = [
  { userId: 'u1', email: 'a@k.demo', firstName: 'Ana', lastName: 'Cobra', phone: null, photoUrl: null, roleId: 'r', roleName: 'COLLECTOR', isOwner: false, isActive: true, userStatus: 'ACTIVE', branchId: 'ch' },
  { userId: 'u2', email: 'b@k.demo', firstName: 'Beto', lastName: 'Sup', phone: null, photoUrl: null, roleId: 'r', roleName: 'COLLECTOR', isOwner: false, isActive: true, userStatus: 'ACTIVE', branchId: null },
];

function renderIt(permissions: string[], rows = ROWS, plan = { used: rows.length, limit: null as number | null }) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <OfficesView rows={rows} types={TYPES} members={MEMBERS} plan={plan} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
});

describe('OfficesView — el árbol', () => {
  it('abre dos niveles y muestra la RUTA COMPLETA en cada fila (dos «Central» no se confunden)', async () => {
    renderIt(['office:read']);
    expect(screen.getByRole('tree')).toBeInTheDocument();
    // La raíz y sus hijas se ven; la nieta (Mesa Verde) queda plegada hasta expandir.
    expect(screen.getByText('La Paz')).toBeInTheDocument();
    expect(screen.queryByText('Mesa Verde')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expandir Chuquisaca' }));
    expect(screen.getByText('Central › Chuquisaca › Mesa Verde')).toBeInTheDocument();
    expect(screen.getByText('Central › Chuquisaca › Central')).toBeInTheDocument();
  });

  it('el buscador muestra la coincidencia con sus ancestros y al limpiar restaura la expansión', async () => {
    renderIt(['office:read']);
    const box = screen.getByRole('searchbox');
    await userEvent.type(box, 'mesa');
    expect(screen.getByText('Mesa Verde')).toBeInTheDocument();
    expect(screen.getByText('Chuquisaca')).toBeInTheDocument();
    expect(screen.queryByText('La Paz')).not.toBeInTheDocument();
    await userEvent.type(box, '{Escape}');
    expect(screen.getByText('La Paz')).toBeInTheDocument();
    expect(screen.queryByText('Mesa Verde')).not.toBeInTheDocument();
  });

  it('el control de nivel y los dígitos fijan cuántos niveles se ven', async () => {
    renderIt(['office:read']);
    await userEvent.click(screen.getByRole('button', { name: 'Expandir todo' }));
    expect(screen.getByText('Mesa Verde')).toBeInTheDocument();
    await userEvent.keyboard('1');
    expect(screen.queryByText('La Paz')).not.toBeInTheDocument();
    await userEvent.keyboard('3');
    expect(screen.getByText('Mesa Verde')).toBeInTheDocument();
  });

  it('«/» enfoca el buscador', async () => {
    renderIt(['office:read']);
    await userEvent.keyboard('/');
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('la vista previa trae la ruta completa, los conteos y «Detalles completos»', async () => {
    renderIt(['office:read']);
    await userEvent.click(screen.getByRole('button', { name: 'Expandir Chuquisaca' }));
    await userEvent.click(screen.getByText('Mesa Verde'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Central › Chuquisaca › Mesa Verde')).toBeInTheDocument();
    expect(within(dialog).getByText('3 personas')).toBeInTheDocument();
    expect(within(dialog).getByText('12 créditos')).toBeInTheDocument();
    // Es un botón (no un enlace): lleva a la ficha con el router.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Detalles completos' }));
    expect(push).toHaveBeenCalledWith('/cuenta/oficinas/mv');
  });
});

describe('OfficesView — permisos (sólo oculta; la API valida)', () => {
  it('con office:read es de lectura: sin añadir, sin tipos, sin arrastre y el menú sólo trae «Ver detalle»', async () => {
    renderIt(['office:read']);
    expect(screen.queryByRole('button', { name: 'Añadir oficina' })).not.toBeInTheDocument();
    expect(screen.queryByText('Tipos de oficina')).not.toBeInTheDocument();
    expect(document.querySelector('[draggable="true"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de La Paz' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Ver detalle']);
  });

  it('con office:write el menú trae todo y la raíz no se mueve ni se desactiva', async () => {
    renderIt(['office:read', 'office:write']);
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de La Paz' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Editar',
      'Añadir hija',
      'Alta rápida',
      'Ver detalle',
      'Mover a…',
      'Desactivar',
    ]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de Central' }));
    const labels = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent);
    expect(labels).not.toContain('Mover a…');
    expect(labels).not.toContain('Desactivar');
  });

  it('la «raíz con cartera y con hijas» lleva a Mover cartera sólo a quien puede repartir', () => {
    const rows = [{ ...central, credits: 40 }, lp];
    const { unmount } = renderIt(['office:read', 'office:write', 'assignment:write'], rows);
    expect(screen.getByRole('button', { name: 'Mover cartera' })).toBeInTheDocument();
    unmount();
    renderIt(['office:read', 'office:write'], rows);
    expect(screen.queryByRole('button', { name: 'Mover cartera' })).not.toBeInTheDocument();
    expect(screen.getByText(/Pídele a quien reparte/)).toBeInTheDocument();
  });

  it('el tope del plan apaga «Añadir» y lo explica', () => {
    renderIt(['office:read', 'office:write'], ROWS, { used: 5, limit: 5 });
    expect(screen.getByRole('button', { name: 'Añadir oficina' })).toBeDisabled();
    expect(screen.getByText(/Tu plan permite 5 oficinas/)).toBeInTheDocument();
  });
});

describe('OfficesView — mover', () => {
  async function dragMesaVerdeToLaPaz() {
    await userEvent.click(screen.getByRole('button', { name: 'Expandir Chuquisaca' }));
    const from = document.querySelector('[data-office-row="mv"]')!;
    const to = document.querySelector('[data-office-row="lp"]')!;
    const data = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(from, { dataTransfer: data });
    fireEvent.dragOver(to, { dataTransfer: data });
    fireEvent.drop(to, { dataTransfer: data });
  }

  it('arrastrar pide confirmación con lo que se mueve y manda el nuevo padre', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/branches/mv/move', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ id: 'mv' });
      }),
    );
    renderIt(['office:read', 'office:write']);
    await dragMesaVerdeToLaPaz();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/¿Mover «Central › Chuquisaca › Mesa Verde» bajo «Central › La Paz»\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/3 personas/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    expect(await screen.findByText('Oficina movida')).toBeInTheDocument();
    expect(enviado).toEqual({ parentId: 'lp' });
    expect(refresh).toHaveBeenCalled();
  });

  it('si el servidor rechaza, muestra su motivo y NO refresca (no se movió nada)', async () => {
    server.use(
      http.post('*/api/branches/mv/move', () =>
        HttpResponse.json({ error: { code: 'BRANCH_MOVE_FORBIDDEN', message: 'No tienes alcance sobre la oficina de destino' } }, { status: 403 }),
      ),
    );
    renderIt(['office:read', 'office:write']);
    await dragMesaVerdeToLaPaz();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No tienes alcance sobre la oficina de destino');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('no deja soltar una oficina dentro de su propio subárbol', async () => {
    renderIt(['office:read', 'office:write']);
    await userEvent.click(screen.getByRole('button', { name: 'Expandir Chuquisaca' }));
    const from = document.querySelector('[data-office-row="ch"]')!;
    const to = document.querySelector('[data-office-row="mv"]')!;
    const data = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(from, { dataTransfer: data });
    fireEvent.drop(to, { dataTransfer: data });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('OfficesView — desactivar', () => {
  it('con créditos y personas no se puede intentar y se dice por qué', async () => {
    renderIt(['office:read', 'office:write']);
    await userEvent.click(screen.getByRole('button', { name: 'Expandir Chuquisaca' }));
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de Mesa Verde' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Tiene 3 personas activas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Tiene 12 créditos/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Desactivar' })).toBeDisabled();
  });
});

describe('Oficina asignada a una persona — una sola por cuenta', () => {
  it('sumar a alguien de otra oficina avisa de cuál viene y no ofrece «agregar otra»', async () => {
    renderIt(['office:read', 'office:write']);
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de La Paz' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Equipo' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Persona' }));
    await userEvent.click(within(dialog).getByRole('option', { name: /Ana Cobra/ }));
    expect(within(dialog).getByText(/está hoy en «Central › Chuquisaca» y pasará a esta oficina/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Cada persona está en una sola oficina/)).toBeInTheDocument();
  });

  it('el 409 del servidor se explica con su motivo', async () => {
    server.use(
      http.post('*/api/branches/lp/members', () =>
        HttpResponse.json({ error: { code: 'ASSIGNMENT_EXISTS', message: 'La persona ya tiene una oficina asignada' } }, { status: 409 }),
      ),
    );
    renderIt(['office:read', 'office:write']);
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de La Paz' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Equipo' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Persona' }));
    await userEvent.click(within(dialog).getByRole('option', { name: /Beto Sup/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Asignar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('La persona ya tiene una oficina asignada');
  });
});

describe('SingleOffice — una sola oficina no ve jerarquía (RULES C2)', () => {
  function renderSingle(permissions: string[], plan: { used: number; limit: number | null }) {
    return render(
      <PermissionsProvider permissions={permissions}>
        <ToastProvider>
          <SingleOffice rows={[central]} types={TYPES} members={MEMBERS} plan={plan} />
        </ToastProvider>
      </PermissionsProvider>,
    );
  }

  it('sin árbol, sin buscador y sin control de nivel', () => {
    renderSingle(['office:read'], { used: 1, limit: 3 });
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Niveles visibles' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Central').length).toBeGreaterThan(0);
  });

  it('con office:write y cupo en el plan ofrece crear la primera agencia', () => {
    renderSingle(['office:read', 'office:write'], { used: 1, limit: 3 });
    expect(screen.getByRole('button', { name: 'Crear la primera oficina' })).toBeInTheDocument();
  });

  it('con el plan en el tope no ofrece crear y manda al plan', () => {
    renderSingle(['office:read', 'office:write'], { used: 1, limit: 1 });
    expect(screen.queryByRole('button', { name: 'Crear la primera oficina' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el plan' })).toHaveAttribute('href', '/cuenta/plan');
  });

  it('sin office:write no hay aviso ni botones', () => {
    renderSingle(['office:read'], { used: 1, limit: 3 });
    expect(screen.queryByRole('button', { name: 'Crear la primera oficina' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});
