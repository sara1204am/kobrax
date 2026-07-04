/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @kobrax/shared se compila a CJS dentro del monorepo; Next lo transpila.
  transpilePackages: ['@kobrax/shared'],
};

export default nextConfig;
