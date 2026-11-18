import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'require_verified_email';

/**
 * Marca un handler (o un controlador) como **sensible**: solo lo puede hacer quien ya confirmó su correo (403 `EMAIL_UNVERIFIED`). Es aparte del
 * contrato de acceso (`@Roles`, `@Authz`…): primero se autoriza por permisos y luego se exige el correo confirmado.
 */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
