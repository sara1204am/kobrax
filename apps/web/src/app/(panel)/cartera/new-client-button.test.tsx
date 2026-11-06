import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { NewClientButton } from './new-client-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function renderButton(permissions: string[]) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <NewClientButton currency="BOB" collateralTypes={[]} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

/** F14 · F2: dar de alta es `client:create`; `client:write` (editar) ya no alcanza. */
describe('NewClientButton — gating por client:create', () => {
  it('con client:create ofrece «Nuevo cliente»', () => {
    renderButton(['client:read', 'client:create']);
    expect(screen.getByRole('button', { name: /nuevo/i })).toBeInTheDocument();
  });

  it('🔴 con sólo client:write no se dibuja', () => {
    renderButton(['client:read', 'client:write']);
    expect(screen.queryByRole('button', { name: /nuevo/i })).not.toBeInTheDocument();
  });
});

describe('NewClientButton — oficina de registro (F14 · F2)', () => {
  const OFICINAS = [
    { id: 'o-mv', name: 'Banco › Chuquisaca › Mesa Verde', depth: 2 },
    { id: 'o-pad', name: 'Banco › Chuquisaca › Padilla', depth: 2 },
  ];
  const abrir = async (offices: typeof OFICINAS, defaultOfficeId = '') => {
    render(
      <PermissionsProvider permissions={['client:read', 'client:create']}>
        <ToastProvider>
          <NewClientButton currency="BOB" collateralTypes={[]} offices={offices} defaultOfficeId={defaultOfficeId} />
        </ToastProvider>
      </PermissionsProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /nuevo/i }));
    return screen.findByRole('dialog');
  };

  it('con varias oficinas elegibles pide elegir una, con la ruta completa', async () => {
    const modal = await abrir(OFICINAS);
    const select = within(modal).getByRole('combobox', { name: /oficina donde se registra/i });
    expect(within(select).getByRole('option', { name: 'Banco › Chuquisaca › Padilla' })).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe('');
  });

  it('arranca en la oficina de quien da de alta si es una de las elegibles', async () => {
    const modal = await abrir(OFICINAS, 'o-pad');
    expect((within(modal).getByRole('combobox', { name: /oficina donde se registra/i }) as HTMLSelectElement).value).toBe('o-pad');
  });

  it('con una sola oficina elegible no hay selector (se manda sola) y sin oficinas tampoco', async () => {
    const modal = await abrir([OFICINAS[0]!]);
    expect(within(modal).queryByRole('combobox', { name: /oficina donde se registra/i })).not.toBeInTheDocument();
  });
});
