import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Member } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import type { BranchRow } from '@/lib/branches';
import { BranchesManager } from './branches-manager';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const BRANCHES: BranchRow[] = [
  { id: 'b1', name: 'Central', code: 'CEN', city: 'La Paz', address: null, managerUserId: 'u1', managerName: 'Sandra Supervisor', active: true, members: 2, credits: 14 },
  { id: 'b2', name: 'Alto Norte', code: 'ALT', city: 'El Alto', address: null, managerUserId: null, managerName: null, active: false, members: 0, credits: 3 },
];

function member(over: Partial<Member> & { userId: string }): Member {
  return {
    email: `${over.userId}@kobrax.demo`,
    firstName: over.userId.toUpperCase(),
    lastName: 'Demo',
    phone: null,
    photoUrl: null,
    roleId: 'r',
    roleName: 'COLLECTOR',
    isOwner: false,
    isActive: true,
    userStatus: 'ACTIVE',
    branchId: null,
    ...over,
  };
}

const MEMBERS: Member[] = [
  member({ userId: 'u1', branchId: 'b1' }),
  member({ userId: 'u2', branchId: 'b1' }),
  member({ userId: 'u3', branchId: null }),
  member({ userId: 'u4', branchId: 'b2', isActive: false }),
];

function renderIt(permissions = ['user:read', 'account:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <BranchesManager branches={BRANCHES} members={MEMBERS} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => refresh.mockClear());

describe('BranchesManager — la lista', () => {
  it('muestra cada agencia con su responsable, miembros y estado', () => {
    renderIt();
    const central = screen.getByText('Central').closest('tr')!;
    expect(within(central).getByText('Sandra Supervisor')).toBeInTheDocument();
    expect(within(central).getByText('Activa')).toBeInTheDocument();
    expect(within(screen.getByText('Alto Norte').closest('tr')!).getByText('Desactivada')).toBeInTheDocument();
  });

  it('sin account:write es de lectura: se ven los miembros pero no hay con qué crear ni editar', () => {
    renderIt(['user:read']);
    expect(screen.queryByText('+ Nueva agencia')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Central' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Miembros de Central' })).toBeInTheDocument();
  });
});

describe('BranchesManager — alta y edición', () => {
  it('crear manda el nombre y el código, y omite lo que quedó vacío', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/branches', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 'nueva' } });
      }),
    );
    renderIt();
    await userEvent.click(screen.getByText('+ Nueva agencia'));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Sucre');
    await userEvent.type(screen.getByLabelText(/Código/), 'suc');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Agencia creada')).toBeInTheDocument();
    expect(enviado).toEqual({ name: 'Sucre', code: 'suc' });
    expect(refresh).toHaveBeenCalled();
  });

  it('un nombre de menos de 2 letras no deja guardar', async () => {
    renderIt();
    await userEvent.click(screen.getByText('+ Nueva agencia'));
    await userEvent.type(screen.getByLabelText('Nombre'), 'S');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('editar manda los datos y vaciar un opcional lo QUITA con null', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/branches/b1', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 'b1' } });
      }),
    );
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Editar Central' }));
    await userEvent.clear(screen.getByLabelText('Ciudad'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await screen.findByText('Agencia guardada');
    expect(enviado).toMatchObject({ name: 'Central', code: 'CEN', city: null, address: null, managerUserId: 'u1', active: true });
  });

  it('muestra el mensaje del servidor si rechaza (p. ej. código repetido)', async () => {
    server.use(
      http.post('*/api/branches', () =>
        HttpResponse.json({ error: { code: 'BRANCH_CODE_DUPLICATE', message: 'Ya existe una agencia con ese código' } }, { status: 409 }),
      ),
    );
    renderIt();
    await userEvent.click(screen.getByText('+ Nueva agencia'));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Otra');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una agencia con ese código');
  });
});

describe('BranchesManager — quitar', () => {
  it('🔴 con miembros activos avisa y no deja confirmar', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Editar Central' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar agencia' }));

    expect(screen.getByText(/Tiene 2 miembros activos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled();
  });

  it('una vacía se quita con DELETE', async () => {
    let borrada = false;
    server.use(
      http.delete('*/api/branches/b2', () => {
        borrada = true;
        return HttpResponse.json({ data: null });
      }),
    );
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Editar Alto Norte' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar agencia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(await screen.findByText('Agencia quitada')).toBeInTheDocument();
    expect(borrada).toBe(true);
  });
});

describe('BranchesManager — miembros', () => {
  it('lista a los activos de la agencia y ofrece sumar a quien no está, diciendo de dónde viene', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Miembros de Central' }));

    expect(screen.getByText('U1 Demo')).toBeInTheDocument();
    expect(screen.getByText('U2 Demo')).toBeInTheDocument();
    // u4 está inactivo (y en otra agencia): no se ofrece. u3 no tiene agencia.
    expect(screen.getByText('U3 Demo')).toBeInTheDocument();
    expect(screen.queryByText('U4 Demo')).not.toBeInTheDocument();
    expect(screen.getByText('sin agencia')).toBeInTheDocument();
  });

  it('sumar a varios manda sus ids en un solo pedido', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/branches/b1/members', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 'b1' } });
      }),
    );
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Miembros de Central' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /U3 Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sumar 1 persona' }));

    expect(await screen.findByText('Miembros movidos a la agencia')).toBeInTheDocument();
    expect(enviado).toEqual({ userIds: ['u3'] });
  });

  it('sacar a alguien lo deja sin agencia (branchId: null) por el endpoint del miembro', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/users/u2', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Miembros de Central' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sacar a U2 Demo de la agencia' }));

    expect(await screen.findByText('Miembro sacado de la agencia')).toBeInTheDocument();
    expect(enviado).toEqual({ branchId: null });
  });

  it('sumar queda apagado sin selección', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Miembros de Central' }));
    expect(screen.getByRole('button', { name: 'Sumar' })).toBeDisabled();
  });

  it('a una agencia desactivada no se le suma gente', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Miembros de Alto Norte' }));
    expect(screen.queryByText('Sumar personas')).not.toBeInTheDocument();
  });
});
