import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { FileStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UploadsService } from './uploads.service';

/** Cada cuánto corre. Es idempotente: un reinicio no la saltea. */
export const FILES_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** D-6: lo subido que no se ató en 24 h (desde la ÚLTIMA subida del mismo contenido) pasa a huérfano. */
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
        where: { accountId, status: FileStatus.PENDING, updatedAt: { lt: pendingBefore }, owners: { none: {} }, deletedAt: null },
        data: { status: FileStatus.ORPHAN, orphanedAt: now },
      });
      const old = await tx.file.findMany({
        where: { accountId, status: FileStatus.ORPHAN, orphanedAt: { lt: orphanBefore }, owners: { none: {} }, deletedAt: null },
        select: { id: true, storageKey: true },
      });
      return { orphaned: orphaned.count, old };
    });
    // Cada archivo en su propia transacción y BAJO BLOQUEO DE FILA: se confirma que sigue huérfano y sin dueños, se marca borrado y se borra el
    // archivo físico antes de soltar el bloqueo. Una subida del mismo contenido registra el archivo ANTES de escribir los bytes
    // (`UploadsService.store`) y su `upsert` espera este bloqueo: o la limpieza gana y la subida revive el registro y escribe después, o la subida
    // gana y la limpieza ve el archivo ya PENDING y lo deja. Si el borrado del disco falla, la transacción se revierte.
    let deleted = 0;
    for (const f of toDelete.old) {
      const removed = await this.prisma.withSystemTenant(accountId, async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT f.id FROM files f
          WHERE f.id = ${f.id} AND f.account_id = ${accountId} AND f.status = 'ORPHAN' AND f.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM file_owners o WHERE o.file_id = f.id)
          FOR UPDATE`;
        if (locked.length === 0) return false;
        await tx.file.update({ where: { id: f.id }, data: { deletedAt: now } });
        await this.uploads.removeForAccount(accountId, f.storageKey);
        return true;
      });
      if (removed) deleted += 1;
    }
    return { orphaned: toDelete.orphaned, deleted };
  }
}
