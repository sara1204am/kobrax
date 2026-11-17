import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * Complemento de `authz-dto-ids.spec` (que sólo cubre la identidad del actor): los ids FORÁNEOS que llegan en un DTO
 * (`creditId`, `clientId`, `visitId`, `branchId`, `collectorId`…) apuntan a datos que quien llama puede no ver. Buscar el
 * registro sólo por id deja pasar un UUID ajeno (S-1 visitas, S-2 pagos).
 *
 * Contrato: todo módulo con un DTO que reciba uno de esos ids debe tener, en sus servicios, una marca de alcance
 * (`visibleCredit*`, `moraScopeOf`, `officeFilter`, `assertCreditInScope`…). Un módulo nuevo con ids foráneos falla acá
 * hasta que alguien revise su alcance y lo deje explícito en el servicio o, con motivo, en `REVIEWED`.
 */
const MODULES = resolve(__dirname);
const FOREIGN_ID = /\b(creditId|clientId|visitId|branchId|collectorId|routeId|routeStopId|agendaItemId|locationId)[!?]?\s*:/;
const SCOPE_MARK = /visibleCredit|visibleClient|assertCreditInScope|officeFilter|moraScopeOf|officeScope|OfficeScope|branchScope|assertCanSee/;
/** Módulos revisados a mano cuyo alcance no usa una de las marcas anteriores (con su motivo). */
const REVIEWED: Record<string, string> = {};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('contrato: ids foráneos en DTOs ↔ alcance en el servicio', () => {
  const files = walk(MODULES).map((f) => ({ f, rel: f.slice(MODULES.length + 1).split(sep).join('/') }));
  const modules = [...new Set(files.filter((x) => /\.dto\.ts$/.test(x.rel) && FOREIGN_ID.test(readFileSync(x.f, 'utf-8'))).map((x) => x.rel.split('/')[0]!))];

  it('hay módulos con ids foráneos (el test no está vacío)', () => {
    assert.ok(modules.length >= 8, modules.join(','));
  });

  it('🔴 cada módulo con ids foráneos en sus DTOs aplica alcance en algún servicio', () => {
    const missing = modules.filter((m) => {
      if (m in REVIEWED) return false;
      const services = files.filter((x) => x.rel.startsWith(`${m}/`) && /\.ts$/.test(x.rel) && !x.rel.endsWith('.spec.ts') && !/\.dto\.ts$/.test(x.rel));
      return !services.some((s) => SCOPE_MARK.test(readFileSync(s.f, 'utf-8')));
    });
    assert.deepEqual(missing, []);
  });
});
