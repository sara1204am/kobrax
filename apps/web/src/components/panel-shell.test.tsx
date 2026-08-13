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

// jsdom no navega: `location.reload` tira «Not implemented». Se reemplaza por un espía.
const reload = vi.fn();
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...window.location, reload },
});
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

function renderShell(
  accounts = ACCOUNTS,
  permissions = ['client:read', 'user:read', 'case:read', 'payment:read'],
  nav = visibleNav(permissions),
) {
  return render(
    <PanelShell user={USER} accounts={accounts} nav={nav}>
      <p>contenido</p>
    </PanelShell>,
  );
}

describe('PanelShell — el menú', () => {
  it('los módulos construidos navegan', () => {
    renderShell();
    // El sidebar y el cajón pintan la misma lista, así que cada rótulo aparece dos veces.
    expect(screen.getAllByRole('link', { name: 'Inicio' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /^Cartera/ }).length).toBeGreaterThan(0); // W3
    expect(screen.getAllByRole('link', { name: /^Casos/ }).length).toBeGreaterThan(0); // W5
    expect(screen.getAllByRole('link', { name: /^Pagos/ }).length).toBeGreaterThan(0); // W7
  });

  it('uno que todavía no existe se pinta en gris y NO navega', () => {
    /*
     * Con un ítem sintético y no con uno del `NAV` real: desde W7 **todos los módulos del menú
     * están construidos**, así que atarla a uno de verdad obligaba a reescribir esta prueba en
     * cada etapa —ya pasó tres veces— y la dejaba sin sujeto al encenderse el último. Lo que se
     * prueba es el contrato del componente: un ítem apagado no es un enlace.
     */
    renderShell(ACCOUNTS, [], [
      { label: 'home', href: '/dashboard', permission: null, built: true },
      { label: 'payments', href: '/futuro', permission: null, built: false },
    ]);

    expect(screen.queryByRole('link', { name: /^Pagos/ })).not.toBeInTheDocument();
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
    // Recarga entera y no `refresh()`: éste conserva el estado de los componentes cliente, y
    // esas pantallas seguirían mostrando datos de la empresa anterior.
    expect(reload).toHaveBeenCalled();
  });

  it('si el cambio falla lo dice y no refresca', async () => {
    server.use(
      http.post('*/api/auth/switch-account', () =>
        HttpResponse.json({ error: { code: 'AUTH_007', message: 'no' } }, { status: 403 }),
      ),
    );

    renderShell();
    reload.mockClear();
    await userEvent.click(screen.getAllByRole('button', { name: 'Kobrax Demo Norte SUPERVISOR' })[0]!);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cambiar de empresa/i);
    expect(reload).not.toHaveBeenCalled();
  });

  it('con una sola empresa no se ofrece cambiar', () => {
    renderShell([ACCOUNTS[0]!]);
    expect(screen.queryByText('Kobrax Demo Norte')).not.toBeInTheDocument();
  });

  it('si la empresa activa no está en la lista, el selector aparece igual', () => {
    // `/auth/accounts` filtra los tenants suspendidos, incluido aquel donde estás parada:
    // esconder el desplegable ahí te deja encerrada, sin más salida que cerrar sesión.
    renderShell([ACCOUNTS[1]!]);
    expect(screen.getAllByText('Empresa no disponible').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Kobrax Demo Norte SUPERVISOR' }).length).toBeGreaterThan(0);
  });
});
