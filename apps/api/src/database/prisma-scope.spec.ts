import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { TenantContextService } from '../common/context/tenant-context.service';
import { DataScope, PrismaService } from './prisma.service';
import type { AppConfigService } from '../config/app-config.service';

/**
 * Contrato del contexto de seguridad que `withTenant` fija en cada transacción (F1 del plan de
 * seguridad). Es lo que después van a leer las policies de RLS, así que si esto se rompe, el
 * aislamiento se rompe en silencio: las consultas siguen funcionando, sólo que devolviendo de más.
 *
 * No hace falta una base: se intercepta `$transaction` y se mira exactamente qué SQL y qué
 * PARÁMETROS salen. Que los valores viajen como parámetros —y no pegados en la sentencia— es
 * justamente lo que se está probando.
 */

const ACCOUNT = 'acc-1';
const USER = 'user-sara';

function harness(scopeRlsMode: 'off' | 'log' | 'enforce' = 'off'): { prisma: PrismaService; tc: TenantContextService; calls: Captured[] } {
  const tc = new TenantContextService();
  const config = {
    appDatabaseUrl: 'postgresql://u:p@localhost:5432/db',
    isProduction: false,
    scopeRlsMode,
  } as AppConfigService;

  const prisma = new PrismaService(config, tc);
  const calls: Captured[] = [];

  // Reemplaza la transacción real por una que corre `fn` con un `tx` de mentira.
  mock.method(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: strings.join('?'), values });
        return Promise.resolve([]);
      },
    }),
  );

  return { prisma, tc, calls };
}

interface Captured {
  sql: string;
  values: unknown[];
}

/** [accountId, userId, scope, scopeMode] — el orden en que `runScoped` los liga. */
function contextOf(calls: Captured[]): unknown[] {
  assert.equal(calls.length, 1, 'se esperaba exactamente una sentencia de contexto');
  return calls[0].values;
}

describe('PrismaService · alcance de cuatro valores (F14 · F2b)', () => {
  const scopeOf = async (permissions: string[]) => {
    const { prisma, tc, calls } = harness();
    await tc.run({ accountId: ACCOUNT, userId: USER, permissions }, () => prisma.withTenant(ACCOUNT, async () => null));
    return contextOf(calls)[2];
  };

  it('cada capacidad llega a PostgreSQL con su propio valor (antes subtree→account y branch→own)', async () => {
    assert.equal(await scopeOf([Permission.DATA_SCOPE_ALL]), DataScope.ACCOUNT);
    assert.equal(await scopeOf([Permission.DATA_SCOPE_SUBTREE]), DataScope.SUBTREE);
    assert.equal(await scopeOf([Permission.DATA_SCOPE_BRANCH]), DataScope.BRANCH);
    assert.equal(await scopeOf([]), DataScope.OWN);
  });

  it('gana el alcance más amplio, como en la API (la misma función por capacidad)', async () => {
    assert.equal(await scopeOf([Permission.DATA_SCOPE_BRANCH, Permission.DATA_SCOPE_SUBTREE]), DataScope.SUBTREE);
    assert.equal(await scopeOf([Permission.DATA_SCOPE_SUBTREE, Permission.DATA_SCOPE_ALL]), DataScope.ACCOUNT);
  });

  it('el modo de la barrera viaja como parámetro: off por omisión, log y enforce cuando se piden', async () => {
    for (const mode of ['off', 'log', 'enforce'] as const) {
      const { prisma, tc, calls } = harness(mode);
      await tc.run({ accountId: ACCOUNT, userId: USER, permissions: [] }, () => prisma.withTenant(ACCOUNT, async () => null));
      assert.equal(contextOf(calls)[3], mode);
      assert.ok(calls[0]!.sql.includes('app.scope_mode'));
    }
  });
});

describe('PrismaService.elevated (F14 · F2b)', () => {
  it('sube a system sólo mientras corre la lectura y restaura el alcance anterior, aun si falla', async () => {
    const seen: string[] = [];
    const tx = {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('current_setting')) return Promise.resolve([{ s: 'branch' }]);
        seen.push(String(values[0]));
        return Promise.resolve([]);
      },
    };
    const { prisma } = harness();
    assert.equal(await prisma.elevated(tx as never, async () => 'ok'), 'ok');
    assert.deepEqual(seen, [DataScope.SYSTEM, 'branch']);
    seen.length = 0;
    await assert.rejects(prisma.elevated(tx as never, async () => Promise.reject(new Error('boom'))), /boom/);
    assert.deepEqual(seen, [DataScope.SYSTEM, 'branch'], 'restaura aunque la lectura falle');
  });
});

describe('PrismaService · contexto de seguridad (F1)', () => {
  it('liga los valores como PARÁMETROS, nunca interpolados en la sentencia', async () => {
    const { prisma, tc, calls } = harness();
    await tc.run({ accountId: ACCOUNT, userId: USER, permissions: [] }, () =>
      prisma.withTenant(ACCOUNT, async () => null),
    );

    const { sql, values } = calls[0];
    // El corazón del asunto: el id NO aparece en el texto de la sentencia.
    assert.ok(!sql.includes(ACCOUNT), 'el accountId quedó interpolado dentro del SQL');
    assert.ok(!sql.includes(USER), 'el userId quedó interpolado dentro del SQL');
    assert.ok(sql.includes('set_config'), 'debe usar set_config(), no SET LOCAL');
    assert.deepEqual(values, [ACCOUNT, USER, DataScope.OWN, 'off']);
  });

  it('fija las variables que leen las policies', async () => {
    const { prisma, tc, calls } = harness();
    await tc.run({ accountId: ACCOUNT, userId: USER, permissions: [] }, () =>
      prisma.withTenant(ACCOUNT, async () => null),
    );

    const { sql } = calls[0];
    for (const v of ['app.current_account_id', 'app.current_user_id', 'app.scope', 'app.scope_mode']) {
      assert.ok(sql.includes(v), `falta la variable ${v}`);
    }
  });

  it('scope=account sólo con el permiso data:scope:all', async () => {
    const { prisma, tc, calls } = harness();
    await tc.run(
      { accountId: ACCOUNT, userId: 'user-supervisor', permissions: [Permission.DATA_SCOPE_ALL] },
      () => prisma.withTenant(ACCOUNT, async () => null),
    );
    assert.deepEqual(contextOf(calls), [ACCOUNT, 'user-supervisor', DataScope.ACCOUNT, 'off']);
  });

  it('scope=own para el cobrador — y es el MISMO en web y en móvil', async () => {
    // El contexto no lleva canal a propósito: no hay de dónde sacar un alcance distinto
    // según el cliente. Si algún día alguien agrega un scope por canal, este test no lo
    // atrapa — lo atrapa el hecho de que `DataScope` sólo tiene tres valores.
    const { prisma, tc, calls } = harness();
    await tc.run(
      { accountId: ACCOUNT, userId: USER, permissions: [Permission.COLLECTION_READ, Permission.CLIENT_READ] },
      () => prisma.withTenant(ACCOUNT, async () => null),
    );
    assert.deepEqual(contextOf(calls), [ACCOUNT, USER, DataScope.OWN, 'off']);
  });

  it('sin contexto de request → scope vacío (DENY), nunca account', async () => {
    const { prisma, calls } = harness();
    await prisma.withTenant(ACCOUNT, async () => null);

    const values = contextOf(calls);
    assert.equal(values[2], '', 'la ausencia de contexto debe dejar el scope vacío');
    assert.notEqual(values[2], DataScope.ACCOUNT);
    assert.notEqual(values[2], DataScope.SYSTEM);
  });

  it('system es explícito: sólo por withSystemTenant()', async () => {
    const { prisma, calls } = harness();
    await prisma.withSystemTenant(ACCOUNT, async () => null);
    assert.deepEqual(contextOf(calls), [ACCOUNT, '', DataScope.SYSTEM, 'off']);
  });

  it('el contrato tiene exactamente cinco scopes: el canal no es un scope', () => {
    assert.deepEqual(Object.values(DataScope).sort(), ['account', 'branch', 'own', 'subtree', 'system']);
  });
});
