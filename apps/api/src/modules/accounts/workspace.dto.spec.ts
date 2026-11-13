import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { createValidationPipe } from '../../common/validation/validation-pipe';
import { UpdateAccountDto } from './dto/account.dto';

/** La API real valida con la tubería global (lista blanca + `forbidNonWhitelisted`), así que se prueba con ella. */
const pipe = createValidationPipe();
const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: UpdateAccountDto });
/** Los campos que la tubería marcó como inválidos (`{ 'workspace.rev': ['…'] }`), o `null` si el cuerpo pasó. */
async function failedFields(body: unknown): Promise<string[] | null> {
  try {
    await run(body);
    return null;
  } catch (err) {
    return Object.keys(((err as { getResponse: () => { fields?: Record<string, string[]> } }).getResponse().fields) ?? {});
  }
}
const ok = { workspace: { version: 1, rev: 0, hiddenModules: ['routes'], options: { 'client.income': false } } };

describe('UpdateAccountDto.workspace (F15 · P1) — la FORMA; el contenido lo valida shared en el service', () => {
  it('acepta un documento bien formado', async () => {
    const dto = (await run(ok)) as UpdateAccountDto;
    assert.deepEqual(dto.workspace?.hiddenModules, ['routes']);
    assert.equal(dto.workspace?.rev, 0);
  });

  it('es opcional: un parche sin `workspace` sigue valiendo', async () => {
    await assert.doesNotReject(run({ businessName: 'Cobranzas Pérez' }));
  });

  it('🔴 `rev` y `version` son obligatorios dentro del documento (sin `rev` no hay control optimista)', async () => {
    assert.deepEqual(await failedFields({ workspace: { version: 1, hiddenModules: [], options: {} } }), ['workspace.rev']);
    assert.deepEqual(await failedFields({ workspace: { rev: 0, hiddenModules: [], options: {} } }), ['workspace.version']);
  });

  it('rechaza tipos equivocados', async () => {
    for (const workspace of [
      { version: '1', rev: 0, hiddenModules: [], options: {} },
      { version: 1, rev: -1, hiddenModules: [], options: {} },
      { version: 1, rev: 1.5, hiddenModules: [], options: {} },
      { version: 1, rev: 0, hiddenModules: 'routes', options: {} },
      { version: 1, rev: 0, hiddenModules: [7], options: {} },
      { version: 1, rev: 0, hiddenModules: [], options: [] },
      { version: 1, rev: 0, hiddenModules: [], options: 'x' },
    ]) {
      const failed = await failedFields({ workspace });
      assert.ok(failed && failed.length > 0, JSON.stringify(workspace));
    }
  });

  it('🔴 un campo desconocido DENTRO del documento es 400, no se ignora', async () => {
    assert.deepEqual(await failedFields({ workspace: { ...ok.workspace, hiddenModulos: ['routes'] } }), ['workspace.hiddenModulos']);
  });

  it('el DTO sigue sin aceptar lo que no es configuración del producto (plan, tope, tipo, estado)', async () => {
    for (const key of ['planCode', 'limitsOverride', 'accountType', 'status', 'configuration']) {
      assert.deepEqual(await failedFields({ [key]: 'x' }), [key]);
    }
  });

  it('G6 · hallazgo 6: `rev` tiene tope (un entero enorme no llega a compararse)', async () => {
    assert.deepEqual(await failedFields({ workspace: { version: 1, rev: 2_000_000_001, hiddenModules: [], options: {} } }), ['workspace.rev']);
    assert.equal(await failedFields({ workspace: { version: 1, rev: 2_000_000_000, hiddenModules: [], options: {} } }), null);
  });

  it('limita la cantidad de módulos que se pueden enviar', async () => {
    assert.deepEqual(await failedFields({ workspace: { version: 1, rev: 0, hiddenModules: Array(33).fill('routes'), options: {} } }), ['workspace.hiddenModules']);
  });
});
