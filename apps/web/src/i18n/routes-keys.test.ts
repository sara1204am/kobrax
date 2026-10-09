import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import es from '@/messages/es.json';
import en from '@/messages/en.json';

/**
 * 🔴 **Toda clave de traducción que usa el módulo de Rutas existe y es un texto** (F4/12).
 *
 * Existe por dos fallas reales de la misma raíz, que ningún test de componente pescó porque cada uno arma sus propios
 * textos: un bloque nuevo (`today: {…}`) **pisó** el texto «Hoy» del selector de día (`today: "Hoy"`), y otro
 * (`days: {…}`) pisó `days: "{n} días"`. En el navegador, `next-intl` responde con `INSUFFICIENT_PATH` y la pantalla
 * entera se cae. JSON no distingue «el mismo nombre dos veces»: el último gana, sin aviso.
 *
 * Lee el código del módulo, busca `t('clave')` atado a su `useTranslations('espacio')` y comprueba contra `es.json` y
 * `en.json`. Las claves armadas con `${…}` se comprueban por su prefijo (tiene que ser un grupo).
 */
const ROOTS = ['src/app/(panel)/rutas', 'src/components/reason-dialog.tsx', 'src/components/route-planner', 'src/components/route-map.tsx'];

function files(path: string): string[] {
  const full = join(process.cwd(), path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((n) => {
    const p = join(path, n);
    const abs = join(process.cwd(), p);
    return statSync(abs).isDirectory() ? files(p) : /\.(tsx?|ts)$/.test(n) && !/\.test\./.test(n) ? [abs] : [];
  });
}

const lookup = (messages: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages);

interface Use {
  file: string;
  ns: string;
  key: string;
  group: boolean;
}

/** Los espacios de nombres que pide cada archivo (`useTranslations('panel.routes')`). */
function namespacesIn(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:useTranslations|getTranslations)\('([^']+)'\)/g)].map((m) => `${file.split('src')[1] ?? file}|${m[1]!}`);
}

function usesIn(file: string): Use[] {
  const src = readFileSync(file, 'utf8');
  const vars = new Map<string, string>();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\('([^']+)'\)/g)) vars.set(m[1]!, m[2]!);
  const out: Use[] = [];
  for (const [name, ns] of vars) {
    for (const m of src.matchAll(new RegExp(`\\b${name}\\('([^']+)'`, 'g'))) out.push({ file, ns, key: m[1]!, group: false });
    // `t(\`status.${x}\`)`: el prefijo tiene que ser un grupo con textos adentro.
    for (const m of src.matchAll(new RegExp(`\\b${name}\\(\`([A-Za-z0-9_.]+)\\.\\$\\{`, 'g'))) out.push({ file, ns, key: m[1]!, group: true });
  }
  return out;
}

const uses = ROOTS.flatMap(files).flatMap(usesIn);
const namespaces = [...new Set(ROOTS.flatMap(files).flatMap(namespacesIn))];

describe('claves de traducción del módulo de Rutas', () => {
  it('encuentra claves que comprobar (si no, el escáner dejó de leer el código)', () => {
    expect(uses.length).toBeGreaterThan(150);
    expect(namespaces.length).toBeGreaterThan(5);
  });

  for (const [lang, messages] of [['es', es], ['en', en]] as const) {
    it(`[${lang}] cada espacio de nombres que se pide existe`, () => {
      // `getTranslations('panel.portfolio.locationType')` (el espacio es `portfolio.locationType`) tiraba MISSING_MESSAGE en el navegador.
      const bad = namespaces.filter((n) => typeof lookup(messages, n.split('|')[1]!) !== 'object');
      expect(bad).toEqual([]);
    });

    it(`[${lang}] cada clave literal existe y es un texto, no un grupo`, () => {
      const bad = uses
        .filter((u) => !u.group)
        .filter((u) => typeof lookup(messages, `${u.ns}.${u.key}`) !== 'string')
        .map((u) => `${u.file.split('rutas')[1] ?? u.file} → ${u.ns}.${u.key}`);
      expect([...new Set(bad)]).toEqual([]);
    });

    it(`[${lang}] cada clave armada con \${…} apunta a un grupo`, () => {
      const bad = uses
        .filter((u) => u.group)
        .filter((u) => {
          const node = lookup(messages, `${u.ns}.${u.key}`);
          return !node || typeof node !== 'object';
        })
        .map((u) => `${u.file.split('rutas')[1] ?? u.file} → ${u.ns}.${u.key}.*`);
      expect([...new Set(bad)]).toEqual([]);
    });
  }
});
