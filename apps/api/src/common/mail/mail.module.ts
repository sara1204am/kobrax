import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Correo saliente. Lo consumen la invitación (S2) y `forgot-password`. */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
