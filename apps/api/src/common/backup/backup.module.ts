import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';

/** Sin controller: no hay endpoint HTTP. Lo levanta `run-backup.ts`, la palanca de consola/cron. */
@Module({
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
