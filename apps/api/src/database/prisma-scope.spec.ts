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

function harness(): { prisma: PrismaService; tc: TenantContextService; calls: Captured[] } {
  const tc = new TenantContextService();
  const config = {
    appDatabaseUrl: 'postgresql://u:p@localhost:5432/db',
    isProduction: false,
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

/** [accountId, userId, scope] — el orden en que `runScoped` los liga. */
function contextOf(calls: Captured[]): unknown[] {
  assert.equal(calls.length, 1, 'se esperaba exactamente una sentencia de contexto');
  return calls[0].values;
}

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
    assert.deepEqual(values, [ACCOUNT, USER, DataScope.OWN]);
  });

  it('fija las tres variables que leen las policies', async () => {
    const { prisma, tc, calls } = harness();
    await tc.run({ accountId: ACCOUNT, userId: USER, permissions: [] }, () =>
      prisma.withTenant(ACCOUNT, async () => null),
    );

    const { sql } = calls[0];
    for (const v of ['app.current_account_id', 'app.current_user_id', 'app.scope']) {
      assert.ok(sql.includes(v), `falta la variable ${v}`);
    }
  });

  it('scope=account sólo con el permiso data:scope:all', async () => {
    const { prisma, tc, calls } = harness();
    await tc.run(
      { accountId: ACCOUNT, userId: 'user-supervisor', permissions: [Permission.DATA_SCOPE_ALL] },
      () => prisma.withTenant(ACCOUNT, async () => null),
    );
    assert.deepEqual(contextOf(calls), [ACCOUNT, 'user-supervisor', DataScope.ACCOUNT]);
  });

  it('scope=own para el cobrador — y es el MISMO en web y en móvil', async () => {
    // El contexto no lleva canal a propósito: no hay de dónde sacar un alcance distinto
    // según el cliente. Si algún día alguien agrega un scope por canal, este test no lo
    // atrapa — lo atrapa el hecho de que `DataScope` sólo tiene tres valores.
    const { prisma, tc, calls } = harness();
    await tc.run(
      { accountId: ACCOUNT, userId: USER, permissions: [Permission.CASE_READ, Permission.CLIENT_READ] },
      () => prisma.withTenant(ACCOUNT, async () => null),
    );
    assert.deepEqual(contextOf(calls), [ACCOUNT, USER, DataScope.OWN]);
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
    assert.deepEqual(contextOf(calls), [ACCOUNT, '', DataScope.SYSTEM]);
  });

  it('el contrato tiene exactamente tres scopes: el canal no es un scope', () => {
    assert.deepEqual(Object.values(DataScope).sort(), ['account', 'own', 'system']);
  });
});
