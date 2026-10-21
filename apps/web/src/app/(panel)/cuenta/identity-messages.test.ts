import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import es from '@/messages/es.json';
import en from '@/messages/en.json';

/**
 * El texto de ayuda del teléfono nombra la variable `{{telefono_negocio}}`. En un mensaje ICU las llaves son sintaxis:
 * sin escapar, next-intl no revienta, escribe la ruta cruda de la clave en la pantalla. Se formatea acá, en los dos idiomas.
 */
describe.each([
  ['es', es],
  ['en', en],
] as const)('textos de identidad (%s)', (locale, messages) => {
  const t = createTranslator({ locale, messages, namespace: 'account.identity' });

  it('la ayuda del teléfono muestra la variable con sus llaves', () => {
    const text = t('phoneHint');
    expect(text).toContain('{{telefono_negocio}}');
    expect(text).not.toContain('account.identity');
  });

  it('todos los textos se formatean sin quedar vacíos', () => {
    for (const key of ['title', 'logo', 'logoHint', 'uploading', 'remove', 'uploadError', 'phone', 'email', 'website', 'websiteHint', 'address', 'city'] as const) {
      const text = t(key);
      expect(text, key).not.toBe('');
      expect(text, key).not.toContain('account.identity');
    }
  });
});
