import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { BackupService } from './backup.service';

/**
 * `pnpm --filter @kobrax/api db:backup` — el backup completo, a mano o desde el cron del host.
 *
 * ⚠️ **Corre sobre `dist/`, no con `tsx`** — mismo motivo que `arrears:run`: el contenedor de
 * Nest lee `design:paramtypes`, metadatos que esbuild no emite. Compilar primero (`pnpm build`).
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const path = await app.get(BackupService).runFull();
    console.log(path);
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
