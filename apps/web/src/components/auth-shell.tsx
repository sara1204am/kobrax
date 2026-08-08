import type { ReactNode } from 'react';

/**
 * Contenedor de todas las pantallas de auth. Split-screen del diseño
 * (`docs/epics-web/login/`): panel de marca a la izquierda, contenido del paso a la derecha, y
 * una barra de confianza abajo cruzando las dos columnas.
 *
 * Es **server component a propósito**: no hay una sola interacción acá, así que nada de esto
 * viaja como JavaScript al navegador. Lo interactivo vive en la `children` de cada pantalla.
 *
 * Las 8 pantallas que lo usan siguen pasando `title` + `subtitle` + children igual que antes:
 * cambia la piel, no el contrato.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  /** Línea corta arriba del título («Bienvenido de vuelta»). Sólo la usa el login. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-k-bg">
      <div className="flex flex-1 flex-col lg:flex-row">
        <BrandPanel />

        <section className="flex flex-1 items-center justify-center px-6 py-10 lg:py-14">
          <div className="w-full max-w-[440px] rounded-2xl border border-k-border bg-white p-7 shadow-k-card sm:p-9">
            {eyebrow && <p className="text-[15px] font-medium text-k-purple">{eyebrow}</p>}
            <h1 className="mt-0.5 text-[30px] font-semibold leading-tight tracking-tight text-k-navy">
              {title}
            </h1>
            <span aria-hidden className="mt-3 block h-[3px] w-10 rounded-full bg-k-purple" />
            {subtitle && <p className="mt-3 text-[14px] leading-relaxed text-k-text-2">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </section>
      </div>

      <TrustBar />
    </main>
  );
}

/**
 * Panel navy de marca. En pantallas angostas se encoge a una franja con el logo: el diseño es de
 * escritorio, pero perder la marca entera en un teléfono sería peor que mostrarla chica.
 */
function BrandPanel() {
  return (
    <aside className="relative overflow-hidden bg-k-hero px-6 py-7 lg:w-[54%] lg:rounded-br-[48px] lg:px-14 lg:py-12">
      {/*
        Velo oscuro sobre la mitad de abajo. `bg-k-hero` termina en periwinkle (#5B7DBE) y sobre
        ese extremo NI el blanco puro llega a 4.5:1 (da 4.09) — o sea que el pie del panel no
        podría llevar texto chico. Con el velo, el blanco al 70% queda en 5.1:1.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-2/3 bg-gradient-to-t from-k-navy/70 to-transparent lg:block"
      />

      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- 40px fijos, no necesita el optimizador */}
          <img src="/logo.png" alt="" width={40} height={40} className="h-10 w-10 object-contain" />
          <span className="text-[22px] font-semibold tracking-[0.18em] text-white">KOBRAX</span>
        </div>

        {/*
          El chip del diseño decía «Cifrado de extremo a extremo». No es cierto y es una afirmación
          de seguridad: hay TLS 1.3 en tránsito y AES-256-GCM en las columnas sensibles, que no es
          E2E. Dice lo que sí hace.
        */}
        <span className="hidden items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 lg:inline-flex">
          <IconShield className="h-5 w-5 shrink-0 text-k-soft-periw" />
          <span className="leading-tight">
            <span className="block text-[13px] font-medium text-white">Plataforma segura</span>
            <span className="block text-[11px] text-white/70">Conexión y datos cifrados</span>
          </span>
        </span>
      </div>

      <div className="relative mt-14 hidden max-w-[520px] lg:block">
        <h2 className="text-[40px] font-semibold leading-[1.15] tracking-tight text-white">
          Cobranza en campo,
          <br />
          resultados en{' '}
          {/*
            El acento va en `k-soft-periw` y no en `k-purple`: sobre el navy del panel, `k-purple`
            da 2.70:1 y no pasa ni el mínimo de texto grande (3:1). Este da 4.51:1.
          */}
          <span className="text-k-soft-periw">tiempo real</span>
        </h2>
        <p className="mt-5 max-w-[380px] text-[15px] leading-relaxed text-white/70">
          Kobrax es la plataforma que transforma tu gestión de cobranzas en eficiencia y
          resultados.
        </p>

        <ul className="mt-10 space-y-6">
          <Feature
            icon={<IconPin />}
            title="Rutas optimizadas"
            text="Ahorra tiempo y recorre más."
          />
          <Feature
            icon={<IconUsers />}
            title="Gestión de clientes"
            text="Toda la información que necesitas, siempre a mano."
          />
          <Feature
            icon={<IconChart />}
            title="Reportes en tiempo real"
            text="Toma decisiones con datos actualizados al instante."
          />
          <Feature
            icon={<IconShield />}
            title="Seguro y confiable"
            text="Tu información y la de tus clientes, siempre protegida."
          />
        </ul>
      </div>
    </aside>
  );
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-k-soft-periw">
        {icon}
      </span>
      <span className="leading-snug">
        <span className="block text-[15px] font-medium text-white">{title}</span>
        <span className="mt-0.5 block max-w-[280px] text-[13px] text-white/70">{text}</span>
      </span>
    </li>
  );
}

/**
 * Barra de confianza del pie. El diseño traía «Cumplimiento normativo · 99,9% de disponibilidad ·
 * Soporte 24/7»: los tres son promesas que hoy nadie puede sostener, y el 99,9% es la misma cifra
 * inventada que ya salió del panel. Estos cuatro son verificables contra el código.
 */
function TrustBar() {
  return (
    <footer className="border-t border-k-border bg-white">
      <ul className="mx-auto grid max-w-6xl gap-5 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
        <TrustItem icon={<IconLock />} title="Conexión cifrada" text="TLS 1.3 en todo el tráfico" />
        <TrustItem icon={<IconShield />} title="Datos protegidos" text="Cifrado en la base de datos" />
        <TrustItem icon={<IconEye />} title="Acceso auditado" text="Toda acción queda registrada" />
        <TrustItem icon={<IconBuilding />} title="Aislamiento por empresa" text="Tus datos no se cruzan" />
      </ul>
    </footer>
  );
}

function TrustItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-k-highlight text-k-purple">
        {icon}
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-medium text-k-text">{title}</span>
        <span className="block text-[12px] text-k-muted">{text}</span>
      </span>
    </li>
  );
}

// ── Íconos ───────────────────────────────────────────────────────────────────
// Inline y no una librería: son seis trazos. Heredan `currentColor` y el tamaño del contenedor.

const svg = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function IconShield({ className }: { className?: string } = {}) {
  return (
    <svg {...svg} className={className} aria-hidden>
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function IconPin() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg {...svg} aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5" />
      <path d="M17 8.5a3 3 0 0 1 0 5M18 14.8c2.1.6 3.5 2.1 3.5 4.2" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M5 20V11M12 20V5M19 20v-6" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg {...svg} aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg {...svg} aria-hidden>
      <rect x="4" y="4" width="8" height="16" rx="1.5" />
      <rect x="14" y="9" width="6" height="11" rx="1.5" />
      <path d="M7 8h2M7 12h2M7 16h2" />
    </svg>
  );
}
