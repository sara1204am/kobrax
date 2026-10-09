import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { MembersTable } from './members-table';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/equipo',
  useSearchParams: () => new URLSearchParams(),
}));

const member = (userId: string, firstName: string, roleName: string, isActive = true) => ({
  userId,
  email: `${firstName.toLowerCase()}@kobrax.demo`,
  firstName,
  lastName: 'Prueba',
  phone: null,
  photoUrl: null,
  roleId: `role-${roleName}`,
  roleName,
  isOwner: false,
  isActive,
  userStatus: 'ACTIVE',
});

const ROSA = member('u-rosa', 'Rosa', 'COLLECTOR');
const MARCO = member('u-marco', 'Marco', 'COLLECTOR');
const GERENTE = member('u-ger', 'Mónica', 'MANAGER');
const BAJA = member('u-baja', 'Elena', 'COLLECTOR', false);
const TEAM = [ROSA, MARCO, GERENTE, BAJA] as never[];

function draw() {
  return render(
    <PermissionsProvider permissions={['user:write']}>
      <ToastProvider>
        <MembersTable
          members={[ROSA] as never[]}
          team={TEAM}
          meta={{ total: 1, page: 1, limit: 25, pages: 1 } as never}
          roles={[]}
          roleNames={['COLLECTOR']}
          meId="u-yo"
        />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

describe('MembersTable · desactivar con trabajo a su nombre (F4/11 · D1)', () => {
  it('si la API dice que tiene trabajo, pide a quién pasarlo y lo manda junto con la baja', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.patch('*/api/users/u-rosa', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if (!body.reassignToUserId) {
          return HttpResponse.json(
            { error: { code: 'USER_HAS_PENDING_WORK', message: 'Tiene trabajo', details: { agenda: 4, credits: 2, routes: 1 } } },
            { status: 409 },
          );
        }
        return HttpResponse.json({ userId: 'u-rosa' });
      }),
    );
    draw();

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }));

    // La segunda ventana dice cuánto tiene y ofrece solo a quien puede recibirlo.
    const dialog = await screen.findByText(/tiene 4 gestiones pendientes, 2 créditos a su cargo y 1 rutas/);
    expect(dialog).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /Pasárselos a/ });
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Marco Prueba');
    expect(options).not.toContain('Rosa Prueba'); // no se lo pasa a sí misma
    expect(options).not.toContain('Mónica Prueba'); // un gerente no recibe cartera
    expect(options).not.toContain('Elena Prueba'); // ni una persona inactiva

    const confirm = screen.getByRole('button', { name: 'Pasar y desactivar' });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(select, 'u-marco');
    await userEvent.click(confirm);

    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual({ isActive: false });
    expect(bodies[1]).toEqual({ isActive: false, reassignToUserId: 'u-marco' });
    expect(refresh).toHaveBeenCalled();
  });

  it('sin trabajo se desactiva directo, sin segunda ventana', async () => {
    server.use(http.patch('*/api/users/u-rosa', () => HttpResponse.json({ userId: 'u-rosa' })));
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Pasar y desactivar' })).toBeNull();
  });
});
