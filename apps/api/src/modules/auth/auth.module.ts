import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../../common/mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { PermissionsService } from './permissions.service';
import { SessionService } from './session.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantGuard } from './guards/tenant.guard';

@Module({
  imports: [JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PermissionsService,
    SessionService,
    MfaService,
    PasswordService,
    JwtAuthGuard,
    RolesGuard,
    TenantGuard,
  ],
  // Exportados para los módulos de recursos y los guards/MFA. CryptoService/BlindIndexService
  // ya no se declaran aquí: viven en el CryptoModule @Global.
  exports: [
    TokenService,
    SessionService,
    PermissionsService,
    MfaService,
    JwtAuthGuard,
    RolesGuard,
    TenantGuard,
  ],
})
export class AuthModule {}
