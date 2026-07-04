'use client';

import { checkPassword } from '@kobrax/shared';

/** Checklist de política de contraseña en tiempo real (fuente: @kobrax/shared). */
export function PasswordChecklist({ password }: { password: string }) {
  if (!password) return null;
  const checks = checkPassword(password);
  return (
    <ul className="space-y-1">
      {checks.map((c) => (
        <li key={c.id} className={`flex items-center gap-2 text-[12px] ${c.passed ? 'text-k-success' : 'text-k-muted'}`}>
          <span aria-hidden>{c.passed ? '✓' : '○'}</span>
          {c.label}
        </li>
      ))}
    </ul>
  );
}

/** True si la contraseña cumple toda la política (espejo de isPasswordValid). */
export function allPassed(password: string): boolean {
  return checkPassword(password).every((c) => c.passed);
}
