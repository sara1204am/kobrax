import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './src/test/msw-server';
import es from './src/messages/es.json';

/**
 * `useTranslations` fuera de Next no tiene de dónde sacar la config del request, así que los
 * componentes tirarían "No intl context found". En vez de envolver cada `render()` en un provider
 * (tocaría todos los tests), se reemplaza el hook por el **traductor de verdad** de next-intl
 * atado a `es.json`.
 *
 * Efecto de lado buscado: los tests siguen afirmando sobre el texto en español real, así que una
 * clave que no exista en `es.json` rompe la prueba en vez de pasar desapercibida.
 */
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useLocale: () => 'es',
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'es', messages: es, namespace }),
  };
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // jsdom + fetch de Node (undici) NO resuelve URLs relativas; el código llama a
  // `/api/...`. Envolvemos el fetch (ya interceptado por MSW) para anteponer el origen,
  // dejando esta capa como la más externa para que MSW reciba una URL absoluta válida.
  const interceptedFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return interceptedFetch(`http://localhost${input}`, init);
    }
    return interceptedFetch(input, init);
  }) as typeof fetch;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
