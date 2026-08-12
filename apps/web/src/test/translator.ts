import type { Translator } from '@/lib/api-error';

/**
 * El traductor de verdad de un idioma, atado a un namespace.
 *
 * Se arma sobre el JSON real y no sobre un doble: así una clave que no exista rompe la prueba en
 * vez de pasar desapercibida, que es justo el agujero de un i18n de dos archivos.
 */
export function translator(messages: Record<string, unknown>, namespace: string): Translator {
  const root = namespace
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);

  const lookup = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], root);

  const t = ((key: string, values: Record<string, string | number> = {}) => {
    const raw = lookup(key);
    if (typeof raw !== 'string') throw new Error(`clave inexistente: ${namespace}.${key}`);
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
  }) as Translator;
  t.has = (key: string) => typeof lookup(key) === 'string';
  return t;
}
