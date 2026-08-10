import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { PanelShell } from './panel-shell';
import { visibleNav } from '@/lib/nav';

const { refresh, replace } = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace }),
  usePathname: () => '/dashboard',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const USER = { name: 'Sandra Supervisor', email: 'sup@kobrax.demo', role: 'SUPERVISOR', accountId: 'a1' };
const ACCOUNTS = [
  { id: 'a1', name: 'Kobrax Demo', role: 'SUPERVISOR', status: 'ACTIVE' },
  { id: 'a2', name: 'Kobrax Demo Norte', role: 'SUPERVISOR', status: 'ACTIVE' },
];

function renderShell(accounts = ACCOUNTS, permissions = ['client:read', 'user:read']) {
  return render(
    <PanelShell user={USER} accounts={accounts} nav={visibleNav(permissions)}>
      <p>contenido</p>
    </PanelShell>,
  );
}

describe('PanelShell — el menú', () => {
  it('un módulo construido navega; uno que todavía no existe no es un enlace', () => {
    renderShell();
    // El sidebar y el cajón pintan la misma lista, así que cada rótulo aparece dos veces.
    expect(screen.getAllByRole('link', { name: 'Inicio' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /^Cartera/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Pronto').length).toBeGreaterThan(0);
  });

  it('marca la pantalla actual para el lector de pantalla', () => {
    renderShell();
    const [inicio] = screen.getAllByRole('link', { name: 'Inicio' });
    expect(inicio).toHaveAttribute('aria-current', 'page');
  });

  it('la hamburguesa dice si el cajón está abierto', async () => {
    renderShell();
    const boton = screen.getByRole('button', { name: 'Abrir el menú' });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(boton).toHaveAttribute('aria-controls', 'panel-drawer');

    await userEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('PanelShell — cambio de empresa', () => {
  it('manda la empresa elegida y refresca desde el servidor', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/auth/switch-account', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    renderShell();
    await userEvent.click(screen.getAllByRole('button', { name: 'Kobrax Demo Norte SUPERVISOR' })[0]!);

    expect(enviado).toEqual({ accountId: 'a2' });
    // `refresh` y no `push`: el shell entero lo pintó el servidor con el token viejo.
    expect(refresh).toHaveBeenCalled();
  });

  it('si el cambio falla lo dice y no refresca', async () => {
    server.use(
      http.post('*/api/auth/switch-account', () =>
        HttpResponse.json({ error: { code: 'AUTH_007', message: 'no' } }, { status: 403 }),
      ),
    );

    renderShell();
    refresh.mockClear();
    await userEvent.click(screen.getAllByRole('button', { name: 'Kobrax Demo Norte SUPERVISOR' })[0]!);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cambiar de empresa/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('con una sola empresa no se ofrece cambiar', () => {
    renderShell([ACCOUNTS[0]!]);
    expect(screen.queryByText('Kobrax Demo Norte')).not.toBeInTheDocument();
  });
});
