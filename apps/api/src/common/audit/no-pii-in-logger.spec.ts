import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * F14 · F4 (E11): ningún `Logger` interpola datos personales (correo, teléfono, documento, dirección). Los registros viajan a
 * herramientas de observabilidad que no tienen el control de acceso de la base. Revisa el CÓDIGO FUENTE: si alguien escribe
 * `this.logger.warn(`... ${user.email}`)` este test falla y dice dónde.
 *
 * Lo que sí puede ir: ids (usuario, cuenta, cliente), conteos, códigos de error.
 */
const SRC = join(__dirname, '..', '..');
const PII_WORDS = /\b(email|e-mail|phone|telefono|teléfono|celular|nationalId|taxId|documento|address|direccion|dirección)\b/i;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.it.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Cada llamada `logger.<nivel>(…)` hasta el `;` que la cierra, para ver también las que ocupan varias líneas. */
function loggerCalls(text: string): { call: string; line: number }[] {
  const out: { call: string; line: number }[] = [];
  const re = /\blogger\s*\.\s*(?:log|warn|error|debug|verbose)\s*\(/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = text.indexOf(';', m.index);
    out.push({ call: text.slice(m.index, end === -1 ? m.index + 400 : end), line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('Registros sin datos personales (F14 · F4)', () => {
  it('🔴 ningún logger.<nivel>(…) interpola correo, teléfono, documento ni dirección', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const { call, line } of loggerCalls(readFileSync(file, 'utf8'))) {
        // Sólo importan las interpolaciones `${…}`: el texto fijo («no se pudo enviar el correo») no es un dato.
        const interpolations = [...call.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1] ?? '');
        if (interpolations.some((expr) => PII_WORDS.test(expr))) offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    assert.deepEqual(offenders, [], `Logger con datos personales interpolados en: ${offenders.join(', ')}`);
  });

  it('el detector detecta (sanidad: un ejemplo con correo se marca)', () => {
    const example = 'this.logger.warn(`reset para ${user.email}: x`);';
    const calls = loggerCalls(example);
    assert.equal(calls.length, 1);
    assert.ok([...calls[0]!.call.matchAll(/\$\{([^}]*)\}/g)].some((x) => PII_WORDS.test(x[1] ?? '')));
  });
});
