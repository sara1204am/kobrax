import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import type { OfficeRow } from '@/lib/offices';
import { MembersTable } from './members-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/equipo',
  useSearchParams: () => new URLSearchParams(),
}));

const office = (id: string, name: string, fullName: string, parentId: string | null, depth: number): OfficeRow =>
  ({ id, name, fullName, parentId, depth, path: `/${id}/`, active: true, isRoot: !parentId, members: 0, credits: 0 }) as unknown as OfficeRow;

const ROSA = {
  userId: 'u-rosa',
  email: 'rosa@kobrax.demo',
  firstName: 'Rosa',
  lastName: 'Prueba',
  phone: null,
  photoUrl: null,
  roleId: 'r',
  roleName: 'COLLECTOR',
  isOwner: false,
  isActive: true,
  userStatus: 'ACTIVE',
  branchId: 'mv',
};

function draw(offices: OfficeRow[]) {
  return render(
    <PermissionsProvider permissions={['user:write']}>
      <ToastProvider>
        <MembersTable
          members={[ROSA] as never[]}
          team={[ROSA] as never[]}
          meta={{ total: 1, page: 1, limit: 25, pages: 1 } as never}
          roles={[]}
          roleNames={['COLLECTOR']}
          meId="u-yo"
          offices={offices}
        />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

describe('MembersTable · oficina (F13)', () => {
  it('con una sola oficina no hay columna de oficina', () => {
    draw([]);
    expect(screen.queryByRole('columnheader', { name: 'Oficina' })).not.toBeInTheDocument();
  });

  it('con varias muestra la columna con la ruta completa', () => {
    draw([office('c', 'Central', 'Central', null, 0), office('mv', 'Mesa Verde', 'Central › Chuquisaca › Mesa Verde', 'c', 2)]);
    expect(screen.getByRole('columnheader', { name: 'Oficina' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Central › Chuquisaca › Mesa Verde')).toBeInTheDocument();
  });
});
