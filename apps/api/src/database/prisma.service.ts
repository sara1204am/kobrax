import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@kobrax/database';
import { AppConfigService } from '../config/app-config.service';

/**
 * Cliente Prisma del runtime de la API. Conecta como `kobrax_app`
 * (APP_DATABASE_URL, NOBYPASSRLS) → toda query queda sujeta a RLS.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfigService) {
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
    return this.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_account_id = '${accountId}'`);
        return fn(tx as unknown as PrismaClient);
      },
      timeout ? { timeout, maxWait: timeout } : undefined,
    );
  }
}
