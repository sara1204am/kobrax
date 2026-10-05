/**
 * Validación de los formularios de acceso en el cliente, antes de llamar a la API.
 * Los textos son los mismos que devuelve el servidor (`login.dto.ts`) y los de la web, para que
 * las dos apps digan lo mismo y un error del servidor se vea igual que uno local.
 */

export const MSG_EMAIL_REQUIRED = 'Ingresa tu correo electrónico';
export const MSG_EMAIL_FORMAT = 'El formato del correo no es válido';
export const MSG_PASSWORD_REQUIRED = 'Ingresa tu contraseña';

/** Misma forma mínima que usa `account-form.ts` y que valida `@IsEmail` del server (el server manda igual). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginField = 'email' | 'password';
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

/** Mensaje de error del correo, o `null` si está bien. */
export function validateEmail(email: string): string | null {
  const v = email.trim();
  if (!v) return MSG_EMAIL_REQUIRED;
  if (!EMAIL_RE.test(v)) return MSG_EMAIL_FORMAT;
  return null;
}

export function validateLogin(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const e = validateEmail(email);
  if (e) errors.email = e;
  if (!password) errors.password = MSG_PASSWORD_REQUIRED;
  return errors;
}

/**
 * Errores por campo que manda la API en `error.details.fields` (`{ email: ['…'] }`).
 * Tolerante: si `details` no tiene esa forma (API vieja, otro tipo de error) devuelve `{}` y el
 * llamador cae al banner general.
 */
export function fieldErrorsFromDetails(details: unknown): LoginFieldErrors {
  if (!details || typeof details !== 'object') return {};
  const fields = (details as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object') return {};
  const out: LoginFieldErrors = {};
  for (const key of ['email', 'password'] as const) {
    const v = (fields as Record<string, unknown>)[key];
    const first = Array.isArray(v) ? v.find((x): x is string => typeof x === 'string') : typeof v === 'string' ? v : undefined;
    if (first) out[key] = first;
  }
  return out;
}
