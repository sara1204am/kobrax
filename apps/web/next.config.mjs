import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @kobrax/shared se compila a CJS dentro del monorepo; Next lo transpila.
  transpilePackages: ['@kobrax/shared'],
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
