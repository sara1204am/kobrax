import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { PreAuthPayload, PreAuthPurpose } from '@kobrax/shared';
import { AppConfigService } from '../../config/app-config.service';

export interface AccessClaims {
  sub: string; // userId
  accountId: string;
  roleId: string;
  permissions: string[];
  sessionId: string;
}

/** Vida del pre-auth token (single-purpose, entre pasos del login). */
const PRE_AUTH_TTL = '5m';

export interface RefreshClaims {
  sub: string;
  accountId: string;
  sessionId: string;
  familyId: string;
  jti: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  /** Access JWT (15 min). `type:'access'` lo distingue del pre-auth token. */
  signAccess(claims: AccessClaims): string {
    return this.jwt.sign(
      { ...claims, type: 'access' },
      { secret: this.config.jwtSecret, expiresIn: this.config.jwtExpiresIn },
    );
  }

  /** Verifica un access JWT (Bearer). Rechaza pre-auth tokens (distinto `type`). */
  verifyAccess(token: string): AccessClaims {
    const payload = this.jwt.verify<AccessClaims & { type?: string }>(token, {
      secret: this.config.jwtSecret,
    });
    if (payload.type !== 'access') throw new Error('Token no es de acceso');
    return payload;
  }

  /**
   * Pre-auth token (5 min, single-purpose): firmado con el secret de acceso pero
   * con `type:'pre_auth'` y sin permisos/accountId. Solo sirve para avanzar entre
   * los pasos del login (mfa / select_account); nunca da acceso a recursos.
   */
  signPreAuth(payload: { sub: string; purpose: PreAuthPurpose; mfaVerified?: boolean }): string {
    return this.jwt.sign(
      { ...payload, type: 'pre_auth' },
      { secret: this.config.jwtSecret, expiresIn: PRE_AUTH_TTL },
    );
  }

  /** Verifica un pre-auth token y exige el propósito esperado (anti-confusión de pasos). */
  verifyPreAuth(token: string, expectedPurpose: PreAuthPurpose): PreAuthPayload {
    const payload = this.jwt.verify<PreAuthPayload & { type?: string }>(token, {
      secret: this.config.jwtSecret,
    });
    if (payload.type !== 'pre_auth' || payload.purpose !== expectedPurpose) {
      throw new Error('Pre-auth token inválido para este paso');
    }
    return payload;
  }

  /** Refresh JWT (7 d). Lleva accountId para fijar el contexto RLS antes del lookup. */
  signRefresh(claims: Omit<RefreshClaims, 'jti' | 'type'>): {
    token: string;
    jti: string;
    hash: string;
  } {
    const jti = randomBytes(32).toString('base64url');
    const token = this.jwt.sign(
      { ...claims, jti, type: 'refresh' },
      { secret: this.config.jwtRefreshSecret, expiresIn: this.config.jwtRefreshExpiresIn },
    );
    return { token, jti, hash: this.hash(jti) };
  }

  verifyRefresh(token: string): RefreshClaims {
    return this.jwt.verify<RefreshClaims>(token, { secret: this.config.jwtRefreshSecret });
  }

  /** SHA-256 hex — lo que se guarda en DB (nunca el token en claro). */
  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
