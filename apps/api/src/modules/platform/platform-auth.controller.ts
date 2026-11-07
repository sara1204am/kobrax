import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ResponseDto } from '@kobrax/shared';
import { Public } from '../auth/decorators/authz.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto, PlatformMfaConfirmDto } from './platform.dto';

/**
 * F14 · F5 (H-11): inicio de sesión de la persona de plataforma. `@Public()` porque se llama SIN token; lo protegen el interruptor externo
 * `PLATFORM_ACCESS_ENABLED` (apagado ⇒ 403 aunque la contraseña sea correcta), el límite de peticiones, el MFA obligatorio y una respuesta única
 * ante cualquier credencial mala. NO existe ninguna ruta que cree, edite o promueva a una persona de plataforma (la cobertura de puertas lo exige).
 */
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 300, by: 'ip' })
  async login(@Body() dto: PlatformLoginDto) {
    return ResponseDto.ok(await this.auth.login(dto.email, dto.password, dto.code));
  }

  @Post('mfa/confirm')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 300, by: 'ip' })
  async confirm(@Body() dto: PlatformMfaConfirmDto) {
    return ResponseDto.ok(await this.auth.confirmMfa(dto.email, dto.password, dto.code));
  }
}
