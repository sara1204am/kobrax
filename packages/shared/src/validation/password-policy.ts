/**
 * Política de contraseñas — fuente única para web, mobile y API.
 * El backend la valida server-side; el front la usa para feedback en tiempo real.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireNumber: true,
  requireSymbol: true,
} as const;

export interface PasswordCheck {
  id: 'length' | 'uppercase' | 'number' | 'symbol';
  label: string;
  passed: boolean;
}

/** Devuelve el detalle de cada regla (para checklist en tiempo real en la UI). */
export function checkPassword(password: string): PasswordCheck[] {
  return [
    { id: 'length', label: `Mínimo ${PASSWORD_POLICY.minLength} caracteres`, passed: password.length >= PASSWORD_POLICY.minLength },
    { id: 'uppercase', label: 'Al menos una mayúscula', passed: /[A-Z]/.test(password) },
    { id: 'number', label: 'Al menos un número', passed: /[0-9]/.test(password) },
    { id: 'symbol', label: 'Al menos un símbolo', passed: /[^A-Za-z0-9]/.test(password) },
  ];
}

/** True si la contraseña cumple toda la política. */
export function isPasswordValid(password: string): boolean {
  return checkPassword(password).every((c) => c.passed);
}
