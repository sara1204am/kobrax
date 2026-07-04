/** Helper de cliente: POST JSON a un route handler del BFF (mismo origen). */
export async function postJson<T = unknown>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T & { error?: { code: string; message: string } } }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
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
