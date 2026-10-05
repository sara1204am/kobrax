import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isBelowMinVersion } from '../app-version';

/** Respuesta 426 para quien corre una app más vieja que `MIN_APP_VERSION`. */
export const APP_UPGRADE_REQUIRED_CODE = 'APP_001';

/** Sesión y salud siguen disponibles: la app vieja debe poder renovar/cerrar sesión y mostrar el aviso. */
const EXEMPT_PATH = /\/(auth|health)(\/|$)/;

/**
 * Corte de versiones de la app móvil. **Apagado por defecto**: sólo actúa si hay `MIN_APP_VERSION` en el entorno
 * Y el cliente manda `x-app-version` (el panel web y las apps que no lo mandan no se ven afectados) Y esa versión
 * es menor. Responde 426 `APP_001` con un mensaje que la app muestra tal cual.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const min = process.env.MIN_APP_VERSION?.trim();
    if (!min) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (EXEMPT_PATH.test(req.path ?? '')) return true;
    const header = req.headers['x-app-version'];
    const version = Array.isArray(header) ? header[0] : header;
    if (!isBelowMinVersion(version, min)) return true;
    throw new HttpException(
      { code: APP_UPGRADE_REQUIRED_CODE, message: `Tu versión de la app ya no es compatible. Actualizá a la versión ${min} o superior para seguir trabajando.` },
      426,
    );
  }
}
