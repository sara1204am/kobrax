import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { ArrearsJobService } from './arrears-job.service';

/**
 * Corre el trabajo diario de mora **una vez, a mano**.
 *
 * `pnpm --filter @kobrax/api arrears:run` — para la primera pasada sobre una cartera que ya existía,
 * y para verificarlo contra datos de verdad sin esperar seis horas al intervalo.
 *
 * Sin argumento barre todos los tenants; con un `accountId`, sólo ése.
 *
 * ⚠️ **Corre sobre `dist/`, no con `tsx`.** El resto de los scripts de la API usan `tsx` y anda,
 * porque las pruebas instancian los servicios a mano (`new ClientsService(...)`). Acá se levanta el
 * contenedor de Nest de verdad, y su inyección lee `design:paramtypes` — metadatos de decorador que
 * esbuild **no emite**. Arrancado con `tsx`, `PrismaService` recibe `undefined` como configuración y
 * revienta con «Cannot read properties of undefined». Hay que compilar primero (`pnpm build`).
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const job = app.get(ArrearsJobService);
  const accountId = process.argv[2];

  const r = accountId ? await job.scanAccount(accountId) : await job.run();
  console.log(JSON.stringify(r));
  await app.close();
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
