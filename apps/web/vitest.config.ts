import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // `react-grid-layout` quedó instalado en el `node_modules` de la raíz y resuelve SU copia de
    // React. Dos copias = "Invalid hook call" apenas se monta la grilla. Next ya deduplica solo;
    // Vite hay que decírselo.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Sin esto Vitest la carga por `import()` nativo, fuera de Vite, y el `dedupe` de arriba no la
    // alcanza: la grilla se monta con su propia copia de React y tira "Invalid hook call".
    server: { deps: { inline: ['react-grid-layout'] } },
  },
});
