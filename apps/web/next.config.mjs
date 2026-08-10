import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
