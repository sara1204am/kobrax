import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './src/test/msw-server';

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
