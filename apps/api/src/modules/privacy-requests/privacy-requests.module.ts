import { Module } from '@nestjs/common';
import { MailModule } from '../../common/mail/mail.module';
import { PrivacyPlatformController, PrivacyRequestsController, PublicReportsController } from './privacy-requests.controller';
import { PrivacyRequestsService } from './privacy-requests.service';

/** Solicitudes de derechos de las personas (privacidad · B6). Prisma y TenantContext desde sus módulos `@Global`. */
@Module({
  imports: [MailModule],
  controllers: [PrivacyRequestsController, PrivacyPlatformController, PublicReportsController],
  providers: [PrivacyRequestsService],
})
export class PrivacyRequestsModule {}
