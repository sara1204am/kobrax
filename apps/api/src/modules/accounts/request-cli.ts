import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AccountRequestsService } from './account-requests.service';

/**
 * Atender una solicitud de una cuenta (cambio de plan, baja) desde la consola:
 *
 *   pnpm --filter @kobrax/api request:handle -- --account <id> --request <id> --status HANDLED --note "Listo, ya es Professional"
 *   pnpm --filter @kobrax/api request:handle -- --account <id> --request <id> --status REJECTED --note "Escríbenos para coordinar"
 *
 * Sólo cambia el estado de la solicitud y deja la nota que la cuenta lee. **No cambia el plan**: eso es `plan:set`.
 *
 * ⚠️ Corre sobre `dist/`, no con `tsx` (mismo motivo que `plan:set`): hay que compilar primero (`pnpm build`).
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      account: { type: 'string' },
      request: { type: 'string' },
      status: { type: 'string' },
      note: { type: 'string' },
    },
  });
  if (!values.account) throw new Error('Falta --account <id>.');
  if (!values.request) throw new Error('Falta --request <id>.');
  if (values.status !== 'HANDLED' && values.status !== 'REJECTED') throw new Error('--status debe ser HANDLED o REJECTED.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const r = await app.get(AccountRequestsService).handle({
      accountId: values.account,
      requestId: values.request,
      status: values.status,
      note: values.note,
    });
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
