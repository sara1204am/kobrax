import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';
import { LEGACY_REDIRECTS } from './legacy-redirects.mjs';

/**
 * Versión pública del producto. El `.env` vive en la raíz del monorepo (lo comparte la API) y Next solo mira `apps/web`, así
 * que se lee de ahí **solo esta variable** (nada más del `.env` llega al navegador). Si ya viene en el entorno del proceso
 * (CI, contenedor) manda ese valor.
 */
function readAppVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const file = fileURLToPath(new URL('../../.env', import.meta.url));
  if (!existsSync(file)) return '';
  const match = readFileSync(file, 'utf8').match(/^APP_VERSION\s*=\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/m);
  return match?.[1]?.trim() ?? '';
}

/**
 * S-10: cabeceras de seguridad. El CSP lleva sólo las directivas que no dependen de los scripts en línea de Next
 * (anti-clickjacking, `<base>`, formularios, plugins): un `script-src` estricto exige nonce por petición y se hace aparte.
 * Permisos: la cámara y la ubicación se piden a propósito (evidencia, rutas); el resto queda apagado.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /** Única variable que se expone al navegador desde el `.env` raíz: `APP_VERSION` (la versión pública del producto). */
  env: { NEXT_PUBLIC_APP_VERSION: readAppVersion() },

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },

  async redirects() {
    return LEGACY_REDIRECTS;
  },

  /**
   * `@kobrax/shared` entra al bundle por un **junction** de pnpm
   * (`node_modules/@kobrax/shared` → `packages/shared`). Con `resolve.symlinks` en su default
   * (`true`) webpack lo resuelve a su ruta real, que queda FUERA de `node_modules` → el loader de
   * react-refresh lo trata como código de la app y le inyecta `import.meta.webpackHot.accept()`.
   * El paquete es CommonJS (`"type": "commonjs"`, lo necesita Nest), y en un módulo CJS
   * `import.meta` es un error de parseo: **500 en toda pantalla que importe de shared**
   * (`password-checklist` → registro, invitación, reset, mfa, mfa-setup, select-account).
   *
   * Con `symlinks: false` la ruta se queda dentro de `node_modules`, react-refresh la saltea y se
   * consume el CJS tal cual. Es seguro acá porque el repo usa `node-linker=hoisted` (ver
   * `.npmrc`): las dependencias ya están planas y la resolución no depende de los enlaces.
   *
   * `next build` nunca lo vio: react-refresh es sólo de desarrollo.
   */
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
