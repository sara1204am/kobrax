import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type SessionMeta } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import type { AuthenticatedUser } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaChallengeDto } from './dto/mfa-challenge.dto';
import { SelectAccountDto } from './dto/select-account.dto';
import { SwitchAccountDto } from './dto/switch-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { MfaSetupStartDto, MfaSetupVerifyDto } from './dto/mfa-setup.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { Authenticated, Public } from './decorators/authz.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  private meta(req: Request): SessionMeta {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceType: (req.headers['x-client-type'] as string) ?? 'api',
    };
  }

  // ── Login (máquina de estados) ───────────────────────────────────────────
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSec: 60, by: 'email-ip' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, this.meta(req));
  }

  @Post('mfa/challenge')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSec: 60, by: 'ip' })
  mfaChallenge(@Body() dto: MfaChallengeDto, @Req() req: Request) {
    return this.auth.mfaChallenge(dto.preAuthToken, dto.code, this.meta(req));
  }

  @Post('select-account')
  @Public()
  @HttpCode(HttpStatus.OK)
  selectAccount(@Body() dto: SelectAccountDto, @Req() req: Request) {
    return this.auth.selectAccount(dto.preAuthToken, dto.accountId, this.meta(req));
  }

  // ── MFA obligatorio: setup durante el login (gated por pre-auth token) ─────
  @Post('mfa/setup/start')
  @Public()
  @HttpCode(HttpStatus.OK)
  mfaSetupStart(@Body() dto: MfaSetupStartDto) {
    return this.auth.mfaSetupStart(dto.preAuthToken);
  }

  @Post('mfa/setup/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  mfaSetupVerify(@Body() dto: MfaSetupVerifyDto, @Req() req: Request) {
    return this.auth.mfaSetupVerify(dto.preAuthToken, dto.code, this.meta(req));
  }

  /** "Lo hago después": entra sin activar MFA. El recordatorio queda en el Home. */
  @Post('mfa/setup/skip')
  @Public()
  @HttpCode(HttpStatus.OK)
  mfaSetupSkip(@Body() dto: MfaSetupStartDto, @Req() req: Request) {
    return this.auth.mfaSetupSkip(dto.preAuthToken, this.meta(req));
  }

  // ── MFA self-service (Bearer) ──────────────────────────────────────────────
  @Post('mfa/enroll')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  enrollMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.enrollMfa(user.userId);
  }

  @Post('mfa/verify')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  verifyMfa(@Body() dto: MfaVerifyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.auth.verifyMfa(user.userId, dto.code);
  }

  @Post('mfa/disable')
  @Authenticated()
  @HttpCode(204)
  async disableMfa(@Body() dto: MfaDisableDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.disableMfa(user.userId, { password: dto.password, code: dto.code });
  }

  @Post('mfa/backup-codes/regenerate')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  regenerateBackupCodes(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.regenerateBackupCodes(user.userId);
  }

  // ── Refresh / Logout ───────────────────────────────────────────────────────
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSec: 60, by: 'ip' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  // ── Recuperación / cambio de contraseña (F2b) ──────────────────────────────
  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowSec: 3600, by: 'email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.passwords.forgotPassword(dto.email);
    return { ok: true }; // respuesta genérica (anti-enumeration)
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.passwords.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  // ── Invitación: los dos endpoints públicos del slice (CUENTA · S2) ─────────
  //
  // El código viaja en la URL sólo para pintar la pantalla; para aceptar va en el body,
  // que no queda escrito en los access logs de nadie.
  @Get('invitation/:code')
  @Public()
  @RateLimit({ limit: 10, windowSec: 60, by: 'ip' })
  getInvitation(@Param('code') code: string) {
    return this.passwords.getInvitation(code);
  }

  @Post('invitation/accept')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSec: 3600, by: 'ip' })
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() req: Request) {
    return this.passwords.acceptInvitation(dto.code, dto.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('change-password')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.passwords.changePassword(user.userId, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  // ── Identidad de la sesión actual ──────────────────────────────────────────
  @Get('me')
  @Authenticated()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user);
  }

  // ── Cambio de empresa con sesión iniciada (W1 del panel web) ───────────────
  @Get('accounts')
  @Authenticated()
  listAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listAccounts(user.userId);
  }

  @Post('switch-account')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  switchAccount(
    @Body() dto: SwitchAccountDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.auth.switchAccount(user.userId, user.sessionId, dto.accountId, this.meta(req));
  }

  // ── Gestión de sesiones (F2b) ──────────────────────────────────────────────
  @Get('sessions')
  @Authenticated()
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.list(user.userId, user.sessionId);
  }

  @Delete('sessions/:id')
  @Authenticated()
  @HttpCode(204)
  async revokeSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.sessions.revokeOne(user.userId, id);
  }

  @Delete('sessions')
  @Authenticated()
  @HttpCode(204)
  async revokeOtherSessions(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.sessions.revokeAll(user.userId, user.sessionId);
  }
}
