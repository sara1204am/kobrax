'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AuthAccountOption } from '@kobrax/shared';
import { LocaleSwitch } from './locale-switch';
import { crumbsFor, type NavItem, type NavKey } from '@/lib/nav';
import { postJson } from '@/lib/client';

/** Fila de cualquiera de los dos menús de la topbar: 44 px de toque, ancho completo. */
const MENU_ITEM =
  'flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-[14px] text-k-text hover:bg-k-bg disabled:opacity-60';

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  accountId: string;
}

/**
 * El shell del panel: sidebar de marca, topbar y el área de contenido.
 *
 * Es cliente entero porque casi todo lo que hace es reaccionar — ítem activo, cajón,
 * desplegables. Los datos llegan armados del layout (server component), que ya los pidió a
 * la API: acá no se hace un solo fetch de identidad.
 *
 * **El menú se escribe una vez** (`NavList`) y se coloca dos veces: fijo a la izquierda en
 * escritorio, y dentro del cajón en pantallas chicas.
 */
export function PanelShell({
  user,
  accounts,
  nav,
  children,
}: {
  user: ShellUser;
  accounts: AuthAccountOption[];
  nav: NavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  // El estado no abre el cajón — eso lo hace `showModal()`. Existe sólo para que la
  // hamburguesa pueda decir `aria-expanded`: sin eso, quien navega con lector de pantalla no
  // sabe si el botón que acaba de tocar abrió algo.
  const [menuOpen, setMenuOpen] = useState(false);

  // Cerrar el cajón al navegar. Sin esto, en el teléfono elegís un ítem y el menú te queda
  // tapando justo la pantalla a la que fuiste.
  useEffect(() => drawer.current?.close(), [pathname]);

  return (
    <div className="min-h-screen bg-k-bg lg:flex">
      {/*
        Sidebar de escritorio. El colapso a íconos entre 1024 y 1279 es puro CSS
        (`lg:w-[68px] xl:w-60`): no hay estado que guardar ni preferencia que recordar.
      */}
      <aside className="sticky top-0 hidden h-screen w-[68px] shrink-0 flex-col bg-k-navy lg:flex xl:w-60">
        <Brand />
        <NavList items={nav} pathname={pathname} collapsible />
      </aside>

      {/*
        Cajón de tablet y celular. Es un <dialog> abierto con showModal(): el foco atrapado,
        la tecla Esc y el fondo oscurecido vienen del navegador. Escribirlos a mano sería
        reescribir tres cosas peor.
      */}
      <dialog
        ref={drawer}
        id="panel-drawer"
        // `close` llega también desde la tecla Esc: las dos salidas pasan por acá.
        onClose={() => setMenuOpen(false)}
        onClick={(e) => {
          if (e.target === drawer.current) drawer.current.close();
        }}
        className="m-0 h-full max-h-none w-[264px] max-w-[85vw] bg-k-navy p-0 backdrop:bg-k-navy/50 lg:hidden"
      >
        <div className="flex h-full flex-col">
          <Brand expanded />
          <NavList items={nav} pathname={pathname} />
        </div>
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          accounts={accounts}
          menuOpen={menuOpen}
          onOpenMenu={() => {
            drawer.current?.showModal();
            setMenuOpen(true);
          }}
        />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-5 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Brand({ expanded = false }: { expanded?: boolean }) {
  return (
    <div className="flex h-16 items-center gap-3 px-5">
      {/* eslint-disable-next-line @next/next/no-img-element -- 28px fijos, no necesita el optimizador */}
      <img src="/logo.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
      <span
        className={`text-[17px] font-semibold tracking-[0.16em] text-white ${
          expanded ? '' : 'hidden xl:inline'
        }`}
      >
        KOBRAX
      </span>
    </div>
  );
}

/**
 * La lista del menú. Un ítem construido es un enlace; uno que todavía no existe es un `span`
 * apagado con su chip: **no tiene `href`, así que no hay 404 posible**.
 */
function NavList({
  items,
  pathname,
  collapsible = false,
}: {
  items: NavItem[];
  pathname: string;
  collapsible?: boolean;
}) {
  const t = useTranslations('panel');
  // En el sidebar colapsado (1024–1279) el rótulo se esconde; en el cajón nunca.
  const labelClass = collapsible ? 'hidden xl:inline' : '';

  return (
    <nav aria-label={t('nav.label')} className="flex-1 overflow-y-auto px-3 py-2">
      <ul className="space-y-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          // El borde transparente está en TODOS los ítems, no sólo en el activo: si apareciera
          // recién al activarse, la fila se correría 3 px cada vez que cambiás de pantalla.
          const base =
            'flex min-h-[44px] items-center gap-3 rounded-xl border-l-[3px] border-transparent px-3 text-[14px] font-medium transition-colors';

          return (
            <li key={item.href}>
              {item.built ? (
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={t(`nav.${item.label}`)}
                  className={`${base} ${
                    active
                      ? 'border-k-soft-periw bg-white/10 text-white'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon name={item.label} />
                  <span className={labelClass}>{t(`nav.${item.label}`)}</span>
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  title={`${t(`nav.${item.label}`)} — ${t('soon')}`}
                  className={`${base} cursor-default text-white/35`}
                >
                  <Icon name={item.label} />
                  <span className={`flex-1 ${labelClass}`}>{t(`nav.${item.label}`)}</span>
                  <span
                    className={`rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50 ${labelClass}`}
                  >
                    {t('soon')}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Topbar({
  user,
  accounts,
  menuOpen,
  onOpenMenu,
}: {
  user: ShellUser;
  accounts: AuthAccountOption[];
  menuOpen: boolean;
  onOpenMenu: () => void;
}) {
  const t = useTranslations('panel');
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname);
  const current = accounts.find((a) => a.id === user.accountId);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-k-border bg-white px-4 md:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t('openMenu')}
        aria-expanded={menuOpen}
        aria-controls="panel-drawer"
        className="-ml-1 flex h-11 w-11 items-center justify-center rounded-xl text-k-text-2 hover:bg-k-bg lg:hidden"
      >
        <Icon name="menu" />
      </button>

      <nav aria-label={t('breadcrumb')} className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-[14px]">
          {crumbs.map((crumb, i) => (
            <li key={crumb.label} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="text-k-muted">
                  /
                </span>
              )}
              {crumb.href ? (
                <Link href={crumb.href} className="truncate text-k-text-2 hover:text-k-text">
                  {t(crumb.label)}
                </Link>
              ) : (
                <span className="truncate font-medium text-k-text">{t(crumb.label)}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Empresa e idioma viven en la topbar desde tablet vertical; en celular se mudan al
          menú de usuario, que es el único desplegable que queda. */}
      {accounts.length > 1 && (
        <div className="hidden md:block">
          <Dropdown label={<span className="max-w-[180px] truncate">{current?.name ?? '—'}</span>}>
            <AccountList accounts={accounts} activeId={user.accountId} />
          </Dropdown>
        </div>
      )}
      <div className="hidden md:block">
        <LocaleSwitch />
      </div>

      <Dropdown
        label={
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-k-highlight text-[13px] font-semibold text-k-purple">
            {initials(user.name)}
          </span>
        }
      >
        <div className="border-b border-k-border px-3 py-2.5">
          <p className="truncate text-[14px] font-medium text-k-text">{user.name}</p>
          <p className="truncate text-[12px] text-k-text-2">{user.email}</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-k-muted">
            {user.role}
          </p>
        </div>

        {accounts.length > 1 && (
          <div className="border-b border-k-border py-1.5 md:hidden">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-k-muted">
              {t('company')}
            </p>
            <AccountList accounts={accounts} activeId={user.accountId} />
          </div>
        )}
        <div className="border-b border-k-border px-3 py-2 md:hidden">
          <LocaleSwitch />
        </div>

        <LogoutItem />
      </Dropdown>
    </header>
  );
}

/**
 * Desplegable sobre `<details>`: abrir y cerrar con teclado y el estado los pone el navegador.
 * Lo único que se agrega es cerrarlo al hacer clic afuera o con Esc, que `details` no trae.
 */
function Dropdown({ label, children }: { label: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close(e: Event) {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      if (ref.current) ref.current.open = false;
    }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-xl px-2 text-[14px] text-k-text-2 hover:bg-k-bg [&::-webkit-details-marker]:hidden">
        {label}
        <Icon name="chevron" className="h-4 w-4 text-k-muted" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-[260px] overflow-hidden rounded-xl border border-k-border bg-white shadow-k-card">
        {children}
      </div>
    </details>
  );
}

/**
 * Las empresas del usuario. Se escribe una vez y se usa en dos lugares: el desplegable de la
 * topbar y, en celular, adentro del menú de usuario.
 */
function AccountList({ accounts, activeId }: { accounts: AuthAccountOption[]; activeId: string }) {
  const router = useRouter();
  const t = useTranslations('panel');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function pick(id: string) {
    if (id === activeId || busy) return;
    setError(false);
    setBusy(id);
    const { ok } = await postJson('/api/auth/switch-account', { accountId: id });
    if (!ok) {
      setBusy(null);
      setError(true);
      return;
    }
    // Refresco del servidor, no navegación del cliente: el shell entero (rol, permisos, menú)
    // lo pintó el servidor con el token viejo.
    router.refresh();
    setBusy(null);
  }

  return (
    <>
      <ul>
        {accounts.map((account) => (
          <li key={account.id}>
            <button
              type="button"
              onClick={() => void pick(account.id)}
              disabled={busy !== null}
              aria-current={account.id === activeId ? 'true' : undefined}
              className={MENU_ITEM}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{account.name}</span>
                <span className="block truncate text-[12px] text-k-text-2">{account.role}</span>
              </span>
              {account.id === activeId && <Icon name="check" className="h-4 w-4 text-k-purple" />}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="px-3 py-2 text-[12px] text-k-danger">
          {t('switchError')}
        </p>
      )}
    </>
  );
}

function LogoutItem() {
  const router = useRouter();
  const t = useTranslations('panel');
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        await postJson('/api/auth/logout', {});
        router.replace('/login');
      }}
      disabled={busy}
      className={MENU_ITEM}
    >
      <Icon name="logout" className="h-[18px] w-[18px] text-k-muted" />
      {t('logout')}
    </button>
  );
}

/** Iniciales para el avatar. Con un nombre vacío devuelve `?` en vez de romper. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}

// ── Íconos ───────────────────────────────────────────────────────────────────
// Inline y no una librería: son trazos sueltos que heredan `currentColor`.

// Tipado contra `NavKey`: sumar un ítem al menú sin darle ícono lo agarra el type-check.
const ICONS: Record<NavKey | 'menu' | 'chevron' | 'check' | 'logout', string> = {
  home: 'M4 10.5 12 4l8 6.5M6.5 9.5V20h11V9.5',
  portfolio: 'M3 8h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8zm0 0a2 2 0 0 1 2-2h11M16 13.5h1.5',
  import: 'M12 3.5v9.5m0 0 3.5-3.5M12 13 8.5 9.5M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5',
  cases: 'M3.5 7.5a2 2 0 0 1 2-2h3l2 2.5h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z',
  agenda: 'M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4',
  routes: 'M12 20.5s5.5-4.8 5.5-9.5a5.5 5.5 0 1 0-11 0c0 4.7 5.5 9.5 5.5 9.5zM12 8.8v2.6',
  payments: 'M3 8h18v9H3zM3 11.5h18M6.5 14.5h2.5',
  team: 'M9 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM2.8 19.5c0-3.4 2.8-5.2 6.2-5.2s6.2 1.8 6.2 5.2M17 8.4a2.8 2.8 0 0 1 0 4.6M18.5 14.6c2 .6 3.2 2 3.2 3.9',
  account: 'M4.5 20V5.5h9V20M13.5 10.5H20V20M7.5 9h3M7.5 12.5h3M7.5 16h3',
  security: 'M12 3.5l7 2.8v5.4c0 3.9-2.9 6.8-7 8.6-4.1-1.8-7-4.7-7-8.6V6.3zM9.2 11.8l2 2 3.6-3.6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevron: 'M7 10l5 5 5-5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  logout: 'M15 7.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1.5M10 12h10m0 0-3-3m3 3-3 3',
};

function Icon({
  name,
  className = 'h-[19px] w-[19px] shrink-0',
}: {
  name: keyof typeof ICONS;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
