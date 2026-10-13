import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AppConfigService } from '../../../config/app-config.service';

/** Un mensaje para UN dispositivo (el servicio itera los dispositivos del usuario). */
export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  /** Solo textos opacos (ids, tipo): FCM exige strings y la app no confía en esto como fuente de verdad. */
  data: Record<string, string>;
  /** Mismo `tag` = el aviso reemplaza al anterior en el teléfono: un reintento no lo duplica. */
  tag: string;
  channelId: string;
}

export type FcmResult =
  | { ok: true }
  | {
      ok: false;
      /** Permanente = el token ya no sirve (se desactiva). Transitorio = reintentable. */
      permanent: boolean;
      code: string;
      message: string;
    };

/** Lo que `PushService` necesita del proveedor: así se prueba sin red y se cambia sin tocar el servicio. */
export interface FcmSender {
  isConfigured(): boolean;
  send(message: FcmMessage): Promise<FcmResult>;
}
export const FCM_SENDER = 'FCM_SENDER';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 8_000;

/** Códigos con los que FCM dice «este token ya no existe / no es válido». */
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'NOT_FOUND', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/**
 * Cliente de FCM (HTTP v1) **sin SDK**: firma el JWT de la cuenta de servicio con `node:crypto`, lo cambia por un token de
 * acceso (cacheado ~1 h) y llama a `messages:send`. Sin `firebase-admin` no hay dependencia nueva ni lockfile que mover.
 *
 * 🔴 **Sin credenciales no es un error**: `isConfigured()` da `false` y el envío queda apagado (mismo criterio que
 * `MailService` sin SMTP). Nunca se registra la clave privada ni el token de ningún dispositivo.
 *
 * Credenciales (una de las dos): `FCM_SERVICE_ACCOUNT_JSON_B64` (el JSON en base64: un `.env` no soporta multilínea) o
 * `FCM_SERVICE_ACCOUNT_FILE` (ruta a un archivo fuera del repo).
 */
@Injectable()
export class FcmClient implements FcmSender, OnModuleInit {
  private readonly logger = new Logger(FcmClient.name);
  private account: ServiceAccount | null | undefined;
  private access: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** Se valida al arrancar: así el log dice «FCM configurado» o «credenciales inválidas» desde el primer minuto, no al primer push. */
  onModuleInit(): void {
    if (!this.loadAccount() && !this.config.fcmServiceAccountB64 && !this.config.fcmServiceAccountFile) {
      this.logger.log('FCM sin credenciales: el push remoto queda apagado (la API funciona igual).');
    }
  }

  isConfigured(): boolean {
    return this.loadAccount() !== null;
  }

  async send(message: FcmMessage): Promise<FcmResult> {
    const account = this.loadAccount();
    if (!account) return { ok: false, permanent: false, code: 'NOT_CONFIGURED', message: 'FCM sin credenciales' };

    for (let attempt = 0; attempt < 2; attempt++) {
      let accessToken: string;
      try {
        accessToken = await this.accessToken(account, attempt > 0);
      } catch (err) {
        return { ok: false, permanent: false, code: 'AUTH_FAILED', message: errorText(err) };
      }

      let res: Response;
      try {
        res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: { priority: 'HIGH', notification: { channel_id: message.channelId, tag: message.tag } },
            },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        return { ok: false, permanent: false, code: 'NETWORK', message: errorText(err) };
      }

      if (res.ok) return { ok: true };

      // 401: el token de acceso venció o fue revocado: se pide otro y se reintenta una vez.
      if (res.status === 401 && attempt === 0) {
        this.access = null;
        continue;
      }
      return this.failure(res);
    }
    return { ok: false, permanent: false, code: 'AUTH_FAILED', message: 'FCM rechazó el token de acceso' };
  }

  private async failure(res: Response): Promise<FcmResult> {
    const body = (await res.json().catch(() => null)) as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    } | null;
    const detail = body?.error?.details?.find((d) => d.errorCode)?.errorCode;
    const code = detail ?? body?.error?.status ?? `HTTP_${res.status}`;
    const message = (body?.error?.message ?? res.statusText).slice(0, 200);
    // 400/404 con código de token muerto = el teléfono ya no está; 429/5xx y el resto = reintentable.
    const permanent = (res.status === 400 || res.status === 404) && DEAD_TOKEN_CODES.has(code);
    return { ok: false, permanent, code, message };
  }

  private async accessToken(account: ServiceAccount, force: boolean): Promise<string> {
    const now = Date.now();
    if (!force && this.access && this.access.expiresAt - 60_000 > now) return this.access.token;

    const iat = Math.floor(now / 1000);
    const uri = account.token_uri ?? DEFAULT_TOKEN_URI;
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: uri, iat, exp: iat + 3600 }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
    const assertion = `${unsigned}.${b64url(signature)}`;

    const res = await fetch(uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OAuth ${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('OAuth sin access_token');
    this.access = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
    return this.access.token;
  }

  /** Lee y valida la cuenta de servicio una sola vez; una credencial mal formada apaga el envío y lo dice UNA vez. */
  private loadAccount(): ServiceAccount | null {
    if (this.account !== undefined) return this.account;
    this.account = null;

    const b64 = this.config.fcmServiceAccountB64;
    const file = this.config.fcmServiceAccountFile;
    if (!b64 && !file) return null;

    try {
      const raw = b64 ? Buffer.from(b64, 'base64').toString('utf8') : readFileSync(file as string, 'utf8');
      const json = JSON.parse(raw) as Partial<ServiceAccount>;
      if (!json.client_email || !json.private_key || !json.project_id) throw new Error('faltan client_email, private_key o project_id');
      this.account = { client_email: json.client_email, private_key: json.private_key, project_id: json.project_id, token_uri: json.token_uri };
      this.logger.log(`FCM configurado (proyecto ${json.project_id}).`);
    } catch (err) {
      // No se imprime el contenido: puede ser una clave privada.
      this.logger.error(`Credenciales de FCM inválidas: ${errorText(err)}. El push remoto queda apagado.`);
    }
    return this.account;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : 'error desconocido';
}
