import type { Request } from 'express';
import { LegalAcceptanceSource } from '@kobrax/shared';

const first = (h: string | string[] | undefined): string | undefined => (Array.isArray(h) ? h[0] : h);

/**
 * Evidencia y origen de una aceptación a partir del request (registro, invitación, perfil o re-aceptación).
 *
 * El origen sale del encabezado `x-client-type` (`mobile` = app; cualquier otro valor o ausencia = web). Es **evidencia de contexto**,
 * no autorización: un cliente puede mentir sobre él y por eso nunca decide un permiso.
 */
export function legalRequestMeta(req: Request, flow: 'signup' | 'invitation' | 'profile' | 'reaccept') {
  const mobile = first(req.headers['x-client-type']) === 'mobile';
  let source: LegalAcceptanceSource;
  if (flow === 'profile') source = LegalAcceptanceSource.PROFILE;
  else if (flow === 'reaccept') source = LegalAcceptanceSource.RE_ACCEPT;
  else if (flow === 'signup') source = mobile ? LegalAcceptanceSource.SIGNUP_MOBILE : LegalAcceptanceSource.SIGNUP_WEB;
  else source = mobile ? LegalAcceptanceSource.INVITATION_MOBILE : LegalAcceptanceSource.INVITATION_WEB;
  return {
    ip: req.ip,
    userAgent: first(req.headers['user-agent']),
    appVersion: first(req.headers['x-app-version']),
    source,
  };
}
