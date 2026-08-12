interface JsonResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: { code: string; message: string } };
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
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
  headers: Record<string, string> = {},
): Promise<JsonResult<T>> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
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
