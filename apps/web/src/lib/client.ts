import {
  getLoadedSessionId,
  publishSessionEvent,
  SESSION_CHANGED_CODE,
  SESSION_HEADER,
  SESSION_STALE_EVENT,
} from './session-sync';

interface JsonResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: { code: string; message: string; details?: unknown } };
}

/**
 * Helper de cliente: manda JSON a un route handler del BFF (mismo origen).
 *
 * `headers` existe por `Idempotency-Key`, que `POST /payments` lee del header y no del cuerpo: sin
 * poder mandarlo, un doble clic registra el pago dos veces sobre un ledger que no se corrige.
 */
export async function sendJson<T = unknown>(
  path: string,
  body: unknown,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  headers: Record<string, string> = {},
): Promise<JsonResult<T>> {
  /*
   * 🔴 `fetch` **rechaza** cuando no hay red (no devuelve una respuesta con `ok:false`), y sin este
   * catch la promesa rechazada sale por arriba de quien llamó. Los 37 llamadores tienen la misma
   * forma —`setBusy(true)` → `await` → `setBusy(false)`—, así que el rechazo se lleva puesto el
   * `setBusy(false)`: la pantalla queda con todos los controles grises, sin mensaje, hasta recargar.
   *
   * Se contesta como un fallo más y **sin objeto de error**: `errorText(undefined, …)` cae en
   * `errors.generic`, que todos los módulos ya tienen traducido. `status: 0` distingue "nunca salió"
   * de un error del servidor, por si algún día alguien lo quiere mirar.
   */
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      // Con qué sesión se cargó esta pestaña: el BFF rechaza (409) si la cookie ya es de otra.
      ...(getLoadedSessionId() ? { [SESSION_HEADER]: getLoadedSessionId() as string } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: {} as JsonResult<T>['data'] };

  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && (data as { error?: { code?: string } })?.error?.code === SESSION_CHANGED_CODE) {
    // El panel muestra «Tu sesión cambió en otra pestaña. Recarga la página para continuar.»
    window.dispatchEvent(new Event(SESSION_STALE_EVENT));
  }
  return { ok: res.ok, status: res.status, data };
}

/** El caso de siempre. Se queda con su nombre porque lo usan 18 llamadas. */
export function postJson<T = unknown>(path: string, body: unknown): Promise<JsonResult<T>> {
  return sendJson<T>(path, body, 'POST');
}

/** Tipo del paso devuelto por el BFF en el flujo de login. */
export type Step = 'done' | 'mfa' | 'mfa_setup' | 'select_account';

export interface AccountOption {
  id: string;
  name: string;
  role: string;
  status: string;
}

/** Router mínimo (evita acoplar a los tipos internos de next/navigation). */
interface MiniRouter {
  push: (href: string) => void;
  replace: (href: string) => void;
}

/** Navegación común tras un paso del login (reutilizada por todas las pantallas). */
export function routeByStep(router: MiniRouter, step: Step, accounts?: AccountOption[] | null): void {
  switch (step) {
    case 'done':
      // Sesión nueva en el navegador: las otras pestañas abiertas tienen que enterarse.
      publishSessionEvent('login');
      router.replace('/dashboard');
      break;
    case 'mfa':
      router.push('/login/mfa');
      break;
    case 'mfa_setup':
      router.push('/login/mfa-setup');
      break;
    case 'select_account':
      if (accounts) sessionStorage.setItem('k_accounts', JSON.stringify(accounts));
      router.push('/login/select-account');
      break;
  }
}
