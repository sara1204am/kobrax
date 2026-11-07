import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@kobrax/database';
import { PermissionScope } from '@kobrax/shared';
import { officeScopeKindOf } from '../common/office-scope/office-scope';
import { AppConfigService } from '../config/app-config.service';
import { TenantContextService } from '../common/context/tenant-context.service';

/**
 * Alcance de datos con el que corre una transacción. Viaja a PostgreSQL en `app.scope` y lo leen
 * las policies de RLS con `app_current_scope()`.
 *
 * **Son exactamente cinco valores. No hay un sexto.** La ausencia de scope no es un valor del
 * contrato: es la falta de uno, y se representa con la variable vacía → `app_current_scope()`
 * devuelve NULL → toda policy escrita contra ella niega. Fail-closed por construcción.
 *
 * ⚠️ **El canal NO es un scope.** No existe `mobile` ni `web`: el mismo `own` rige para los dos.
 * El alcance lo determina la base y las apps sólo lo consumen; si el móvil tuviera su propio
 * modelo de seguridad, habría dos verdades y la más débil sería la real.
 *
 * Reutiliza los valores de `PermissionScope` (shared) en vez de inventar un vocabulario paralelo:
 * son el mismo concepto visto desde la base.
 */
export const DataScope = {
  /** Toda la cartera del tenant (`data:scope:all`: administrador, auditor, lector). No depende del canal. */
  ACCOUNT: PermissionScope.ACCOUNT,
  /** F14 · F2b: el subárbol de las oficinas de la persona (`data:scope:subtree`, gerente regional); asignada a la raíz, todo. */
  SUBTREE: 'subtree',
  /** F14 · F2b: lo suyo más lo de su(s) oficina(s) (`data:scope:branch`, supervisor). */
  BRANCH: 'branch',
  /**
   * Sólo la **asignación efectiva** del usuario del contexto: su asignación permanente más las
   * temporales vigentes. Hoy: el cobrador, en web y en móvil por igual.
   * NO es `assignee_id = usuario actual` — ver el contrato en `docs/security/PLAN-SEGURIDAD.md §4.bis`.
   */
  OWN: PermissionScope.OWN,
  /** Trabajos de sistema y flujos pre-sesión. **Nunca por omisión**: se pide explícitamente. */
  SYSTEM: 'system',
} as const;

export type DataScopeValue = (typeof DataScope)[keyof typeof DataScope];

/** El alcance por capacidad (API) → el valor que entiende PostgreSQL. */
const SCOPE_OF_KIND = {
  ALL: DataScope.ACCOUNT,
  SUBTREE: DataScope.SUBTREE,
  BRANCH: DataScope.BRANCH,
  OWN: DataScope.OWN,
} as const;

/** Ausencia de scope: variable vacía → NULL en la base → DENY. No es un valor del contrato. */
const NO_SCOPE = '';

/**
 * Cliente Prisma del runtime de la API. Conecta como `kobrax_app`
 * (APP_DATABASE_URL, NOBYPASSRLS) → toda query queda sujeta a RLS.
 */
/** Las tablas con policy de alcance (`rls/006_scope_policies.sql`: `scope_<tabla>`). Una sola lista para el chequeo de arranque. */
export const SCOPE_POLICY_TABLES = ['credits', 'clients', 'payments', 'agenda_items', 'route_plans'] as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** F14 · F2b: `off` | `log` | `enforce`. Viaja a PostgreSQL en `app.scope_mode`. */
  private readonly scopeMode: 'off' | 'log' | 'enforce';

  constructor(
    config: AppConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    super({
      datasourceUrl: config.appDatabaseUrl,
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
    this.scopeMode = config.scopeRlsMode;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma conectado como kobrax_app (RLS activa)');
    await this.assertScopeBarrierInstalled();
  }

  /**
   * F14·F2b — con `SCOPE_RLS_MODE` en `log` o `enforce` la segunda barrera TIENE que existir en la base. Si las policies no están
   * (falta aplicar `pnpm db:rls`), la API correría "protegida" sin estarlo: falla abierto sin que nada lo avise. Mejor no arrancar.
   * Con `off` no se pregunta nada (la base puede estar sin las policies).
   */
  private async assertScopeBarrierInstalled(): Promise<void> {
    if (this.scopeMode === 'off') return;
    const expected = SCOPE_POLICY_TABLES.map((t) => `scope_${t}`);
    const rows = await this.$queryRaw<{ policies: bigint; member: boolean; inherits: boolean; gaps: bigint }[]>`
      SELECT (SELECT count(*) FROM pg_policies WHERE policyname = ANY(${expected}::text[]) AND permissive = 'RESTRICTIVE' AND roles = '{kobrax_scoped}') AS policies,
             COALESCE((SELECT pg_has_role('kobrax_app', 'kobrax_scoped', 'MEMBER') FROM pg_roles WHERE rolname = 'kobrax_scoped'), false) AS member,
             COALESCE((SELECT pg_has_role('kobrax_app', 'kobrax_scoped', 'USAGE') FROM pg_roles WHERE rolname = 'kobrax_scoped'), false) AS inherits,
             (SELECT count(*) FROM information_schema.role_table_grants g
               WHERE g.grantee = 'kobrax_app' AND g.table_schema = 'public'
                 AND NOT has_table_privilege('kobrax_scoped', format('%I.%I', g.table_schema, g.table_name), g.privilege_type)) AS gaps`;
    const { policies, member, inherits, gaps } = rows[0] ?? { policies: 0n, member: false, inherits: false, gaps: 0n };
    const problems: string[] = [];
    if (Number(policies) < expected.length) problems.push(`hay ${Number(policies)} de ${expected.length} policies de alcance para kobrax_scoped (${expected.join(', ')})`);
    if (!member) problems.push('kobrax_app no puede cambiar al rol kobrax_scoped (¿falta el rol o el GRANT?)');
    if (inherits) problems.push('kobrax_app hereda kobrax_scoped, así que las policies de alcance le aplicarían a TODOS (falta ALTER ROLE kobrax_app NOINHERIT)');
    if (Number(gaps) > 0) problems.push(`a kobrax_scoped le faltan ${Number(gaps)} permisos de tabla que sí tiene kobrax_app (el usuario con alcance restringido recibiría "permission denied")`);
    if (problems.length > 0) {
      throw new Error(`SCOPE_RLS_MODE=${this.scopeMode} pero la barrera no está bien instalada: ${problems.join('; ')}. Aplicá "pnpm db:rls" (rls/006_scope_policies.sql) o poné SCOPE_RLS_MODE=off.`);
    }
    this.logger.log(`Barrera RLS de alcance: modo ${this.scopeMode} (${SCOPE_POLICY_TABLES.length} policies, rol kobrax_scoped y permisos al día)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Ejecuta `fn` dentro del contexto RLS de un tenant.
   * `SET LOCAL` solo vive dentro de esta transacción → todas las queries del
   * request deben ejecutarse con el `tx` que recibe `fn`.
   *
   * `timeout` sube el tope de 5 s que Prisma le pone a una transacción interactiva. **No se toca
   * para un request**: si atender una pantalla tarda más de cinco segundos, el problema es la
   * consulta y no el límite. Existe para las tareas de sistema que recorren la cartera entera —hoy
   * el trabajo diario de mora—, donde un lote de cientos de créditos con su trigger de
   * denormalización sí pasa de cinco segundos y no hay nadie esperando del otro lado.
   */
  async withTenant<T>(accountId: string, fn: (tx: PrismaClient) => Promise<T>, timeout?: number): Promise<T> {
    const ctx = this.tenantContext.get();
    if (!ctx) {
      /*
       * Sin contexto de request no se puede saber a nombre de quién corre esto, así que el alcance
       * es `none` y las policies no entregan nada. Se avisa —en vez de romper— porque F1 sólo
       * SETEA las variables: hasta que existan las policies (F2) nada cambia de comportamiento, y
       * este warn es justamente el inventario de los llamadores que hay que convertir a
       * `withSystemTenant` antes de que F2 entre.
       */
      this.logger.warn(
        `withTenant sin contexto de request (account ${accountId}) → sin scope (DENY). ` +
          'Si es un trabajo de sistema o un flujo pre-sesión, usar withSystemTenant().',
      );
    }
    // F14 · F2b: el alcance llega a la base con sus cuatro valores reales, calculados con la MISMA función que usa la API
    // (`officeScopeKindOf`, por capacidad). Antes `subtree` se colapsaba en `account` y `branch` en `own`: nada leía `app.scope`.
    const scope = !ctx ? NO_SCOPE : SCOPE_OF_KIND[officeScopeKindOf((p) => ctx.permissions.includes(p))];

    return this.runScoped(accountId, ctx?.userId ?? '', scope, fn, timeout);
  }

  /**
   * F14 · F2b: sube a alcance `system` **dentro de la transacción en curso** para UNA lectura que necesita ver toda la cuenta aunque
   * quien pide tenga un alcance menor (los topes del plan, la detección de duplicados, el emparejamiento de las importaciones), y
   * vuelve al alcance original. No cambia de transacción ni de usuario: sólo el alcance de lectura, y sólo mientras corre `fn`.
   *
   * 🔴 **Uso explícito y mínimo.** `grep "\.elevated("` lista todos los lugares; cada uno debe poder justificar en una línea por qué
   * necesita la cuenta entera. Nunca para devolverle datos ajenos a quien pregunta: sólo para contar o para detectar existencia.
   */
  async elevated<T>(tx: PrismaClient, fn: () => Promise<T>): Promise<T> {
    const rows = await tx.$queryRaw<{ s: string | null }[]>`SELECT current_setting('app.scope', true) AS s`;
    const previous = rows[0]?.s ?? NO_SCOPE;
    await tx.$queryRaw`SELECT set_config('app.scope', ${DataScope.SYSTEM}, true)`;
    try {
      return await fn();
    } finally {
      await tx.$queryRaw`SELECT set_config('app.scope', ${previous}, true)`;
    }
  }

  /**
   * Igual que `withTenant` pero con acceso a toda la empresa **sin** usuario detrás.
   *
   * Es la única puerta de elevación, y es explícita a propósito: `grep withSystemTenant` lista
   * todos los lugares que ven la empresa entera. Es para los trabajos de sistema (mora, avisos de
   * plan, ciclo de vida, CLI) y para los flujos que ocurren antes de que exista sesión (alta de
   * cuenta, invitación, recuperación de contraseña). **No se usa para atender un request
   * autenticado**: ahí el alcance sale del rol, que es todo el punto.
   */
  async withSystemTenant<T>(
    accountId: string,
    fn: (tx: PrismaClient) => Promise<T>,
    timeout?: number,
  ): Promise<T> {
    return this.runScoped(accountId, '', DataScope.SYSTEM, fn, timeout);
  }

  /**
   * Abre la transacción y fija el contexto que leen las policies de RLS.
   *
   * 🔴 **Va con `set_config`, no con `SET LOCAL`.** `SET LOCAL` no acepta parámetros ligados, así
   * que la versión anterior interpolaba el `accountId` dentro de la sentencia
   * (`$executeRawUnsafe`). Hoy no era explotable —el id sale del JWT firmado— pero era la única
   * línea armada con concatenación de todo el sistema, y de ella depende el aislamiento entre
   * empresas: alcanzaba con un llamador futuro que pasara un id venido de un parámetro para cerrar
   * la comilla y reescribir el tenant. `set_config` es una función normal y acepta parámetros.
   */
  private async runScoped<T>(
    accountId: string,
    userId: string,
    scope: DataScopeValue | typeof NO_SCOPE,
    fn: (tx: PrismaClient) => Promise<T>,
    timeout?: number,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.current_account_id', ${accountId}, true),
                                  set_config('app.current_user_id', ${userId}, true),
                                  set_config('app.scope', ${scope}, true),
                                  set_config('app.scope_mode', ${this.scopeMode}, true)`;
        /*
         * F14·F2b — las policies de alcance sólo existen para el rol `kobrax_scoped`. Quien tiene alcance de TODA la cuenta (o el sistema)
         * sigue como `kobrax_app`, sin policy alguna: así su costo es cero (con la policy, aunque no filtrara nada, el planificador perdía
         * los index-only scans de los conteos: ×1,3 a ×3 en los listados del administrador). El alcance vacío (sin contexto) SÍ cambia de
         * rol: es fail-closed. Con el modo `off` nadie cambia de rol: la barrera está apagada y no cuesta nada.
         */
        if (this.scopeMode !== 'off' && scope !== DataScope.ACCOUNT && scope !== DataScope.SYSTEM) {
          await tx.$executeRaw`SET LOCAL ROLE kobrax_scoped`;
        }
        return fn(tx as unknown as PrismaClient);
      },
      timeout ? { timeout, maxWait: timeout } : undefined,
    );
  }
}
