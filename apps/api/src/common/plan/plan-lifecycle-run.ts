import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PlanLifecycleService } from './plan-lifecycle.service';

/**
 * Corre el ciclo de vida de planes (L4) **una vez, a mano**:
 * `pnpm --filter @kobrax/api plan:lifecycle` — sin argumento barre todos los tenants; con un
 * `accountId`, sólo ése. Mismo patrón (y misma advertencia) que `arrears:run`:
 * ⚠️ corre sobre `dist/`, no con `tsx` — compilar primero (`pnpm build`).
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const job = app.get(PlanLifecycleService);
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
