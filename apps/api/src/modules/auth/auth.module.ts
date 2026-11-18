import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../../common/audit/audit.module';
import { MailModule } from '../../common/mail/mail.module';
import { LegalModule } from '../legal/legal.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { PermissionsService } from './permissions.service';
import { SessionService } from './session.service';
import { AuthzVersionService } from './authz-version.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { EmailVerificationService } from './email-verification.service';
import { RequireVerifiedEmailGuard } from './guards/require-verified-email.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthzGuard } from './guards/authz.guard';
import { TenantGuard } from './guards/tenant.guard';

@Module({
  imports: [JwtModule.register({}), MailModule, AuditModule, LegalModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PermissionsService,
    SessionService,
    AuthzVersionService,
    MfaService,
    PasswordService,
    EmailVerificationService,
    // F14 · F3: guards GLOBALES, en este orden (los globales corren antes que los de controlador): sesión → tenant → permisos.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    // Acciones sensibles (`@RequireVerifiedEmail()`): invitar y exportar exigen el correo confirmado. Después de autorizar por permisos.
    { provide: APP_GUARD, useClass: RequireVerifiedEmailGuard },
  ],
  // Exportados para los módulos de recursos y los guards/MFA. CryptoService/BlindIndexService
  // ya no se declaran aquí: viven en el CryptoModule @Global.
  exports: [
    TokenService,
    SessionService,
    AuthzVersionService,
    PermissionsService,
    MfaService,
    EmailVerificationService,
  ],
})
export class AuthModule {}
