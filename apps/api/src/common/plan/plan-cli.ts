import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PlanToolsService } from './plan-tools.service';

/**
 * La palanca por consola (LIMITES-BUILD-PLAN §L3):
 *
 *   pnpm --filter @kobrax/api plan:set -- --account <id> --plan BUSINESS
 *   pnpm --filter @kobrax/api plan:set -- --account <id> --override '{"users":40}'
 *   pnpm --filter @kobrax/api plan:set -- --account <id> --override null
 *   pnpm --filter @kobrax/api account:suspend -- --account <id> [--lift]
 *
 * ⚠️ **Corre sobre `dist/`, no con `tsx`** — mismo motivo que `arrears:run`: el contenedor de Nest
 * lee `design:paramtypes`, metadatos que esbuild no emite. Compilar primero (`pnpm build`).
 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      account: { type: 'string' },
      plan: { type: 'string' },
      override: { type: 'string' },
      lift: { type: 'boolean' },
    },
  });
  const cmd = positionals[0];
  if (!values.account) throw new Error('Falta --account <id>.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const tools = app.get(PlanToolsService);
    const r =
      cmd === 'suspend'
        ? await tools.suspend(values.account, { lift: values.lift })
        : await tools.setPlan({ accountId: values.account, plan: values.plan, override: values.override });
    console.log(JSON.stringify(r));
  } finally {
    await app.close();
  }
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error((e as Error)?.message ?? e);
    process.exit(1);
  },
);
