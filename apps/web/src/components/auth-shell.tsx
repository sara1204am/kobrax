import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LocaleSwitch } from './locale-switch';

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
  wide,
  children,
}: {
  /** Línea corta arriba del título («Bienvenido de vuelta»). Sólo la usa el login. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /**
   * Columna ancha. La usa **sólo el paso de elegir plan**: comparar tres planes es una tarea de
   * lado a lado, y tres tarjetas apiladas en 440 px obligan a recordar la primera para juzgar la
   * tercera. Los ocho pasos de auth siguen en la medida de siempre.
   */
  wide?: boolean;
  children: ReactNode;
}) {
  const ancho = wide ? 'max-w-[880px]' : 'max-w-[440px]';

  return (
    <main className="flex min-h-screen flex-col bg-k-bg">
      <div className="flex flex-1 flex-col lg:flex-row">
        <BrandPanel />

        {/*
          Centrado vertical solo mientras la pantalla es baja (laptop). En tablet vertical
          (iPad 1024×1366) el panel izquierdo deja su contenido arriba y el formulario, centrado,
          quedaba flotando lejos: de 900 px de alto para arriba el formulario arranca arriba,
          a la altura del titular de la izquierda (W-LOG-04).
        */}
        <section className="flex flex-1 flex-col items-center justify-center px-6 py-10 lg:py-14 lg:[@media(min-height:900px)]:justify-start lg:[@media(min-height:900px)]:pt-24">
          <div className={`mb-5 flex w-full ${ancho} justify-end`}>
            <LocaleSwitch />
          </div>

          <div className={`w-full ${ancho} rounded-2xl border border-k-border bg-white p-7 shadow-k-card sm:p-9`}>
            {eyebrow && <p className="text-k-md font-medium text-k-purple">{eyebrow}</p>}
            <h1 className="mt-0.5 text-[30px] font-semibold leading-tight tracking-tight text-k-navy">
              {title}
            </h1>
            <span aria-hidden className="mt-3 block h-[3px] w-10 rounded-full bg-k-purple" />
            {subtitle && <p className="mt-3 text-k-base leading-relaxed text-k-text-2">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </section>
      </div>

    </main>
  );
}

/**
 * Panel navy de marca. En pantallas angostas se encoge a una franja con el logo: el diseño es de
 * escritorio, pero perder la marca entera en un teléfono sería peor que mostrarla chica.
 */
function BrandPanel() {
  const t = useTranslations('shell');

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
          <span className="text-k-3xl font-semibold tracking-[0.18em] text-white">KOBRAX</span>
        </div>

        {/*
          El chip del diseño decía «Cifrado de extremo a extremo». No es cierto y es una afirmación
          de seguridad: hay TLS 1.3 en tránsito y AES-256-GCM en las columnas sensibles, que no es
          E2E. Dice lo que sí hace.
        */}
        <span className="hidden items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 lg:inline-flex">
          <IconShield className="h-5 w-5 shrink-0 text-k-soft-periw" />
          <span className="leading-tight">
            <span className="block text-k-sm font-medium text-white">{t('chipTitle')}</span>
            <span className="block text-k-2xs text-white/70">{t('chipText')}</span>
          </span>
        </span>
      </div>

      <div className="relative mt-14 hidden max-w-[520px] lg:block">
        {/*
          El titular va entero en UN mensaje con el corte y el acento adentro. Partirlo en tres
          claves obligaría al traductor a poner «tiempo real» al final de la frase, que es donde
          cae en español y no necesariamente en otro idioma.

          El acento va en `k-soft-periw` y no en `k-purple`: sobre el navy del panel, `k-purple`
          da 2.70:1 y no pasa ni el mínimo de texto grande (3:1). Este da 4.51:1.
        */}
        <h2 className="text-[40px] font-semibold leading-[1.15] tracking-tight text-white">
          {t.rich('headline', {
            br: () => <br />,
            accent: (chunks) => <span className="text-k-soft-periw">{chunks}</span>,
          })}
        </h2>
        <p className="mt-5 max-w-[380px] text-k-md leading-relaxed text-white/70">
          {t('tagline')}
        </p>

        <ul className="mt-10 space-y-6">
          <Feature
            icon={<IconPin />}
            title={t('features.routesTitle')}
            text={t('features.routesText')}
          />
          <Feature
            icon={<IconUsers />}
            title={t('features.clientsTitle')}
            text={t('features.clientsText')}
          />
          <Feature
            icon={<IconChart />}
            title={t('features.reportsTitle')}
            text={t('features.reportsText')}
          />
          <Feature
            icon={<IconShield />}
            title={t('features.securityTitle')}
            text={t('features.securityText')}
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
        <span className="block text-k-md font-medium text-white">{title}</span>
        <span className="mt-0.5 block max-w-[280px] text-k-sm text-white/70">{text}</span>
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
