import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * F14 · F3 (N-13): el servidor NUNCA confía en una identidad del actor que llegue en el cuerpo. Un DTO de entrada no puede traer
 * `accountId` / `userId` / `actorId` / `createdBy` / `tenantId` validados con `@IsUUID`. Quien actúa y su tenant salen de la sesión.
 * Lista blanca (cada una con su motivo): cambiar de cuenta recibe la cuenta DESTINO, que el servicio valida contra las membresías.
 */
const SRC = resolve(__dirname, '..');
const WHITELIST: Record<string, string> = {
  'modules/auth/dto/select-account.dto.ts': 'elige a qué cuenta entrar; se valida contra las membresías del usuario',
  'modules/auth/dto/switch-account.dto.ts': 'idem: cuenta destino, validada contra las membresías',
};

function dtoFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return dtoFiles(full);
    return /\.dto\.ts$/.test(name) && !name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('F14·F3 — N-13: ningún DTO de entrada acepta la identidad del actor', () => {
  it('🔴 sin accountId/userId/actorId/createdBy/tenantId con @IsUUID fuera de la lista blanca', () => {
    const pattern = /@IsUUID[^\n]*\n(?:\s*@\w+[^\n]*\n)*\s*(?:readonly\s+)?(accountId|userId|actorId|createdBy|tenantId)[!?]?\s*:/;
    const offenders = dtoFiles(SRC)
      .map((f) => ({ rel: f.slice(SRC.length + 1).split(sep).join('/'), text: readFileSync(f, 'utf-8') }))
      .filter((f) => !(f.rel in WHITELIST))
      .filter((f) => pattern.test(f.text))
      .map((f) => f.rel);
    assert.deepEqual(offenders, []);
  });

  it('la lista blanca no tiene entradas muertas (el archivo existe y todavía trae el campo)', () => {
    for (const rel of Object.keys(WHITELIST)) {
      assert.match(readFileSync(join(SRC, rel), 'utf-8'), /accountId/, rel);
    }
  });
});
