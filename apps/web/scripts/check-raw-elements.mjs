#!/usr/bin/env node
/**
 * Ratchet de diseño (P2-C): cuenta los `<button>`, `<select>` y `<textarea>` escritos a mano fuera de los componentes del sistema
 * y compara contra `raw-elements-baseline.json`. **Falla si algún conteo SUBE**; si baja, avisa para que se actualice el baseline.
 *
 *   node scripts/check-raw-elements.mjs            # verifica (es el `lint` de la web)
 *   node scripts/check-raw-elements.mjs --update   # reescribe el baseline con el estado actual (tras migrar)
 *
 * No impide los casos legítimos que ya existen (celdas de calendario, filas clicables): sólo impide sumar más. La meta es que el
 * baseline sólo baje a medida que cada módulo migra a `Button`, `Select`, `Textarea` y `Tabs`.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'scripts', 'raw-elements-baseline.json');
const TAGS = ['button', 'select', 'textarea'];
/** Tamaños de letra a mano (`text-[13px]`): la escala vive en `tailwind.config.ts` (`text-k-sm`…). Sólo puede bajar. */
const FONT_PX = 'fontPx';
const KEYS = [...TAGS, FONT_PX];
/** Donde SÍ viven los elementos crudos: son los componentes que los envuelven. */
const ALLOWED = new Set(['components/ui.tsx', 'components/panel-ui.tsx', 'components/form-kit.tsx', 'components/modal.tsx', 'components/data-table.tsx']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [full] : [];
  });
}

export function count() {
  const totals = Object.fromEntries(KEYS.map((t) => [t, 0]));
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(file, 'utf8');
    totals[FONT_PX] += (text.match(/\btext-\[\d+(?:\.\d+)?px\]/g) ?? []).length;
    for (const tag of TAGS) totals[tag] += (text.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) ?? []).length;
  }
  return totals;
}

const current = count();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log('baseline actualizado:', current);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`Falta ${BASELINE}. Créalo con: node scripts/check-raw-elements.mjs --update`);
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
let failed = false;
for (const tag of KEYS) {
  if (current[tag] > base[tag]) {
    failed = true;
    console.error(
      tag === FONT_PX
        ? `✗ text-[Npx]: ${current[tag]} (baseline ${base[tag]}). Usa la escala text-k-* de tailwind.config.ts.`
        : `✗ <${tag}> crudo: ${current[tag]} (baseline ${base[tag]}). Usa el componente del sistema (Button / Select / Textarea / Tabs).`,
    );
  } else if (current[tag] < base[tag]) {
    console.log(`✓ ${tag === FONT_PX ? "text-[Npx]" : `<${tag}>`} crudo bajó: ${current[tag]} (baseline ${base[tag]}). Corre --update para fijar la mejora.`);
  } else {
    console.log(`✓ ${tag === FONT_PX ? "text-[Npx]" : `<${tag}>`} crudo: ${current[tag]}`);
  }
}
process.exit(failed ? 1 : 0);
