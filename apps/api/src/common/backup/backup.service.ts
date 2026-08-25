import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { AppConfigService } from '../../config/app-config.service';

/** Cuántos días de dumps se conservan en disco antes de podarlos. */
const RETENTION_DAYS = 14;

/**
 * Backup completo de la base, para el equipo de Kobrax — **no vive en ningún panel de cuenta**.
 * Un `pg_dump` mezcla filas de todos los tenants; exponerlo como botón en una cuenta sería dejar
 * que esa cuenta se baje datos de otras. Esto es infraestructura: se corre por cron contra
 * `DATABASE_URL` (el rol dueño del esquema, no `kobrax_app`, que tiene RLS activa y no vería nada
 * fuera de un tenant).
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly config: AppConfigService) {}

  private get dir(): string {
    return resolve(process.env.BACKUP_DIR ?? join(process.cwd(), 'backups'));
  }

  /** Corre `pg_dump`, comprime el resultado y poda lo vencido. Devuelve la ruta del archivo nuevo. */
  async runFull(): Promise<string> {
    const url = this.config.databaseUrl;
    if (!url) throw new Error('DATABASE_URL no configurada — hace falta el rol dueño del esquema, no APP_DATABASE_URL');

    await mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(this.dir, `kobrax-full-${stamp}.sql.gz`);

    const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    dump.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    await pipeline(dump.stdout, createGzip(), createWriteStream(file));
    const code: number = await new Promise((res) => dump.on('close', res));
    if (code !== 0) throw new Error(`pg_dump salió con código ${code}: ${stderr.trim()}`);

    this.logger.log(`Backup completo escrito en ${file}`);
    await this.prune();
    return file;
  }

  /** Borra los `.sql.gz` de más de `RETENTION_DAYS` días. No toca nada que no haya escrito este servicio. */
  private async prune(): Promise<void> {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const names = await readdir(this.dir).catch(() => []);
    for (const name of names) {
      if (!name.startsWith('kobrax-full-') || !name.endsWith('.sql.gz')) continue;
      const path = join(this.dir, name);
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await unlink(path);
        this.logger.log(`Backup vencido borrado: ${name}`);
      }
    }
  }
}
