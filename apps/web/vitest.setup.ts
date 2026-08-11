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
 *
 * ⚠️ El traductor se cachea por namespace. next-intl memoiza el suyo, y devolver uno nuevo en cada
 * render acá haría que un `useCallback([t])` o un `useEffect([t])` se re-dispare para siempre: el
 * componente entra en bucle y la suite **se cuelga sin mensaje de error**. Costó encontrarlo una
 * vez; que no cueste dos.
 */
const translators = new Map<string, unknown>();

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useLocale: () => 'es',
    useTranslations: (namespace?: string) => {
      const key = namespace ?? '';
      if (!translators.has(key)) {
        translators.set(key, actual.createTranslator({ locale: 'es', messages: es, namespace }));
      }
      return translators.get(key);
    },
  };
});

/**
 * jsdom trae `HTMLDialogElement` pero **sin `showModal()` ni `close()`**. Cualquier
 * componente que use un `<dialog>` (el cajón del menú, el modal) revienta al montar con
 * "close is not a function". Es un agujero del entorno de test, no del código, así que va acá
 * y no una guarda defensiva en producción.
 *
 * El doble mantiene coherente el atributo `open`, que es lo único que los tests observan. Lo
 * que jsdom tampoco da y esto no simula: foco atrapado, Esc y backdrop — eso lo pone el
 * navegador de verdad y se verifica a mano.
 */
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    // El elemento de verdad dispara `close` acá, y es por donde el navegador avisa que se
    // cerró con Esc. Sin el evento, un `onClose` no se podría probar.
    this.dispatchEvent(new Event('close'));
  };
}

/**
 * Otro agujero del entorno: jsdom **no implementa `matchMedia`**, así que cualquier componente
 * que consulte el ancho de la ventana revienta al montar. El doble responde «no coincide»,
 * que en los tests equivale a una pantalla angosta.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

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
