import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from './jwt-auth.guard';
import { EmailVerificationService } from '../email-verification.service';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/require-verified-email.decorator';

export const emailUnverified = () =>
  new ForbiddenException({
    code: 'EMAIL_UNVERIFIED',
    message: 'Confirma tu correo para hacer esto. Te enviamos un enlace; si no lo ves, pídelo de nuevo desde el aviso del panel.',
  });

/**
 * Frena las acciones SENSIBLES hasta que la persona confirme su correo. GLOBAL, como los demás guards (corre después de `AuthzGuard`), y solo
 * actúa donde el handler (o su clase) lleva `@RequireVerifiedEmail()`: invitar personas y exportar datos. Entrar y trabajar no se frena: un error
 * de tipeo en el correo no puede dejar a nadie fuera. La plataforma (sesión de soporte) no es una persona de empresa y pasa.
 */
@Injectable()
export class RequireVerifiedEmailGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verification: EmailVerificationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_EMAIL_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const user = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user || user.actorType === 'PLATFORM') return true;
    if (await this.verification.isVerified(user.userId)) return true;
    throw emailUnverified();
  }
}
