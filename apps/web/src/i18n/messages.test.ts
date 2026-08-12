import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { DEFAULT_LOCALE, isLocale, LOCALES } from './config';

/** Aplana `{a: {b: 'x'}}` → `['a.b']` para comparar los dos archivos como conjuntos de claves. */
function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('mensajes', () => {
  /**
   * El agujero real de un i18n de dos archivos: se agrega una clave en español, se olvida el
   * inglés, y el panel en inglés muestra la clave cruda recién cuando alguien entra a esa
   * pantalla. Acá se cae en el test.
   */
  it('es y en tienen exactamente las mismas claves', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });

  it('ninguna traducción quedó vacía', () => {
    for (const [locale, messages] of [['es', es], ['en', en]] as const) {
      const empty = keys(messages).filter((path) => {
        const value = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], messages);
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(empty, `claves vacías en ${locale}.json`).toEqual([]);
    }
  });

  /**
   * Una clave declarada **dos veces dentro del mismo objeto** no la ve nadie: `JSON.parse` se
   * queda con la última sin chistar, el type-check pasa y el test de arriba también, porque los
   * dos idiomas quedan rotos igual. Se cobró a `panel.import.settings`, que era el rótulo de un
   * botón y además el namespace de una pantalla: ganó el objeto y el botón dibujó la ruta cruda
   * de la clave, en los dos idiomas.
   *
   * En JSON el único string seguido de `:` es una clave, así que contarlos en el texto y
   * compararlos con los que sobrevivieron al parseo delata cualquier duplicado.
   */
  it('ninguna clave está declarada dos veces', () => {
    const countKeys = (node: unknown): number =>
      typeof node === 'object' && node !== null
        ? Object.keys(node).length + Object.values(node).reduce<number>((n, v) => n + countKeys(v), 0)
        : 0;

    for (const [locale, messages] of [['es', es], ['en', en]] as const) {
      // Relativo al cwd (`apps/web`, donde corre vitest): `import.meta.url` acá resuelve contra
      // la raíz del disco y no contra el archivo.
      const raw = readFileSync(`src/messages/${locale}.json`, 'utf8');
      const declared = raw.match(/"(?:[^"\\]|\\.)*"\s*:/g)?.length ?? 0;
      expect(declared, `claves duplicadas en ${locale}.json`).toBe(countKeys(messages));
    }
  });
});

describe('isLocale', () => {
  /**
   * Es la guarda del `import()` dinámico de `request.ts`: sin ella, el valor de una cookie que
   * escribe el navegador termina armando una ruta de archivo.
   */
  it('sólo acepta los locales declarados', () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale('pt')).toBe(false);
    expect(isLocale('../../secreto')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('')).toBe(false);
  });

  it('el default es un locale válido', () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });
});
