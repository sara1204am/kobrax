'use client';

import { useTranslations } from 'next-intl';
import { checkPassword, PASSWORD_POLICY } from '@kobrax/shared';

/**
 * Checklist de política de contraseña en tiempo real.
 *
 * La **regla** viene de `@kobrax/shared` (fuente única con la API y el móvil); el **texto** sale de
 * los mensajes de la web, indexado por `check.id`. El `label` que trae shared se ignora a
 * propósito: está sólo en español y traducirlo allá arrastraría i18n al paquete compartido, que
 * también consume la API — donde nadie muestra nada.
 */
export function PasswordChecklist({ password }: { password: string }) {
  const t = useTranslations('password');
  if (!password) return null;

  return (
    <ul className="space-y-1">
      {checkPassword(password).map((c) => (
        <li
          key={c.id}
          className={`flex items-center gap-2 text-[12px] ${c.passed ? 'text-k-success' : 'text-k-muted'}`}
        >
          <span aria-hidden>{c.passed ? '✓' : '○'}</span>
          {t(c.id, { min: PASSWORD_POLICY.minLength })}
        </li>
      ))}
    </ul>
  );
}

/** True si la contraseña cumple toda la política (espejo de isPasswordValid). */
export function allPassed(password: string): boolean {
  return checkPassword(password).every((c) => c.passed);
}
