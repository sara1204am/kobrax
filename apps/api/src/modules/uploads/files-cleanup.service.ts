import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { FileStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UploadsService } from './uploads.service';

/** Cada cuánto corre. Es idempotente: un reinicio no la saltea. */
export const FILES_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** D-6: lo subido que no se ató en 24 h pasa a huérfano. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** D-6: el archivo físico de un huérfano se borra a los 7 días, si sigue sin dueño. */
export const ORPHAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FilesCleanupResult {
  orphaned: number;
  deleted: number;
}

/**
 * F14 · F4 (D-6): la limpieza de archivos. Un archivo `PENDING` que nadie ató en 24 h pasa a `ORPHAN`; un `ORPHAN` sin dueños que lleva 7 días se
 * borra del disco y del registro (borrado lógico). Un archivo con algún dueño NUNCA se toca. Mismo patrón que `PlanLifecycleService`:
 * enumera las cuentas vivas y limpia cada una bajo su propia RLS; el fallo de una no detiene a las demás.
 */
@Injectable()
export class FilesCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FilesCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), FILES_CLEANUP_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<FilesCleanupResult> {
    const total: FilesCleanupResult = { orphaned: 0, deleted: 0 };
    let accountIds: string[];
    try {
      const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM promise_due_account_ids()`;
      accountIds = rows.map((r) => r.account_id);
    } catch (err) {
      this.logger.warn(`promise_due_account_ids() no disponible — limpieza de archivos sin correr: ${err instanceof Error ? err.message : String(err)}`);
      return total;
    }
    for (const accountId of accountIds) {
      try {
        const r = await this.cleanAccount(accountId, now);
        total.orphaned += r.orphaned;
        total.deleted += r.deleted;
      } catch (err) {
        this.logger.error(`Limpieza de archivos falló en la cuenta ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (total.orphaned || total.deleted) this.logger.log(`Archivos: ${total.orphaned} pasaron a huérfanos, ${total.deleted} borrados`);
    return total;
  }

  async cleanAccount(accountId: string, now: Date = new Date()): Promise<FilesCleanupResult> {
    const pendingBefore = new Date(now.getTime() - PENDING_TTL_MS);
    const orphanBefore = new Date(now.getTime() - ORPHAN_TTL_MS);
    const toDelete = await this.prisma.withSystemTenant(accountId, async (tx) => {
      const orphaned = await tx.file.updateMany({
        where: { accountId, status: FileStatus.PENDING, createdAt: { lt: pendingBefore }, owners: { none: {} }, deletedAt: null },
        data: { status: FileStatus.ORPHAN, orphanedAt: now },
      });
      const old = await tx.file.findMany({
        where: { accountId, status: FileStatus.ORPHAN, orphanedAt: { lt: orphanBefore }, owners: { none: {} }, deletedAt: null },
        select: { id: true, storageKey: true },
      });
      return { orphaned: orphaned.count, old };
    });
    // La marca de borrado PRIMERO y con la condición «sigue huérfano y sin dueños»; el archivo físico sólo se borra si esa marca se aplicó. Así un
    // archivo que se ató justo ahora (el trigger lo pasó a ATTACHED) nunca pierde su contenido. Si el borrado del disco falla, sólo queda un archivo
    // suelto (inofensivo), nunca un dueño apuntando a un archivo que no está.
    let deleted = 0;
    for (const f of toDelete.old) {
      const marked = await this.prisma.withSystemTenant(accountId, (tx) =>
        tx.file.updateMany({ where: { id: f.id, accountId, status: FileStatus.ORPHAN, owners: { none: {} }, deletedAt: null }, data: { deletedAt: now } }),
      );
      if (marked.count === 1) {
        await this.uploads.removeForAccount(accountId, f.storageKey);
        deleted += 1;
      }
    }
    return { orphaned: toDelete.orphaned, deleted };
  }
}
