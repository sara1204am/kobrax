import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@kobrax/database';
import { Permission, PermissionScope } from '@kobrax/shared';
import { AppConfigService } from '../config/app-config.service';
import { TenantContextService } from '../common/context/tenant-context.service';

/**
 * Alcance de datos con el que corre una transacción. Viaja a PostgreSQL en `app.scope` y lo leen
 * las policies de RLS con `app_current_scope()`.
 *
 * **Son exactamente tres valores. No hay un cuarto.** La ausencia de scope no es un valor del
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
  /** Toda la cartera del tenant. Admin y supervisión. No depende del canal. */
  ACCOUNT: PermissionScope.ACCOUNT,
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

/** Ausencia de scope: variable vacía → NULL en la base → DENY. No es un valor del contrato. */
const NO_SCOPE = '';

/**
 * Cliente Prisma del runtime de la API. Conecta como `kobrax_app`
 * (APP_DATABASE_URL, NOBYPASSRLS) → toda query queda sujeta a RLS.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    config: AppConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    super({
      datasourceUrl: config.appDatabaseUrl,
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma conectado como kobrax_app (RLS activa)');
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
    const scope = !ctx
      ? NO_SCOPE
      : ctx.permissions.includes(Permission.DATA_SCOPE_ALL)
        ? DataScope.ACCOUNT
        : DataScope.OWN;

    return this.runScoped(accountId, ctx?.userId ?? '', scope, fn, timeout);
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
                                  set_config('app.scope', ${scope}, true)`;
        return fn(tx as unknown as PrismaClient);
      },
      timeout ? { timeout, maxWait: timeout } : undefined,
    );
  }
}
