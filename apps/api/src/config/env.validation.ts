import { z } from 'zod';

/** Esquema de entorno. Si algo falta o es inválido → la app NO arranca (fail-fast). */
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  // Runtime de la API: rol kobrax_app (NOBYPASSRLS) — nunca el superuser.
  APP_DATABASE_URL: z.string().url(),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener ≥ 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET debe tener ≥ 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  // F14 · F1: compara las versiones `av`/`pv` del JWT en cada petición. `off` deja el guard como antes (sólo denylist de sesión).
  AUTHZ_VERSION_CHECK: z.enum(['on', 'off']).default('on'),
  /** F14 · F2b: segunda barrera de RLS por alcance (`off` | `log` | `enforce`). */
  SCOPE_RLS_MODE: z.enum(['off', 'log', 'enforce']).default('off'),
  /** F14 · F4: secreto de los enlaces firmados de archivos (opcional: si falta se deriva de JWT_SECRET). */
  FILE_LINK_SECRET: z.string().min(16).optional(),
  /**
   * F14 · F4 (D-2): `on` = el documento va siempre enmascarado y sin revelar en el canal móvil. Apagado hasta que el móvil se refactorice (F8).
   * ⚠️ El canal hoy sale del encabezado `x-client-type`, que manda el cliente: sirve para esta regla de UX/cumplimiento mientras esté apagada, pero
   * NO es una barrera contra quien tenga un token robado. Al encenderla en F8 el canal debe salir de la sesión (`user_sessions.device_type`).
   */
  PII_MOBILE_MASK: z.enum(['on', 'off']).default('off'),
  /** F14 · F3: `enforce` = handler sin contrato → 403 AUTHZ_000; `log` = pasa y lo registra (válvula de rollback de un release). */
  AUTHZ_DENY_BY_DEFAULT: z.enum(['enforce', 'log']).default('enforce'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SOCKET_CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Requerido cuando se implemente el cifrado AES-256 (MFA secret); opcional al boot.
  APP_ENCRYPTION_KEY: z.string().optional(),
  // Blind index (HMAC) para documentos cifrados (F4). El BlindIndexService valida 32 bytes al boot.
  APP_BLIND_INDEX_KEY: z.string().optional(),
  // SMTP de Gmail (CUENTA · S2). Opcionales a propósito: sin ellas el MailService
  // loguea el correo en vez de enviarlo, así que el módulo corre sin credenciales.
  // SMTP_PASS es una **contraseña de aplicación** de Google, no la del correo.
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // Push remoto (FCM HTTP v1, Android). Opcionales: sin credenciales el envío queda apagado y todo lo demás sigue igual.
  // Una de las dos: el JSON de la cuenta de servicio en base64 (un .env no soporta multilínea) o la ruta a un archivo FUERA
  // del repo. Nunca se registran en logs.
  FCM_SERVICE_ACCOUNT_JSON_B64: z.string().optional(),
  FCM_SERVICE_ACCOUNT_FILE: z.string().optional(),
  // Hasta cuándo un rol crítico sin MFA puede postergar el enrolamiento (fecha ISO). Sin valor = obligatorio ya.
  MFA_CRITICAL_GRACE_UNTIL: z.string().optional(),
  // Versión mínima de la app móvil (semver). Sin valor = sin corte; ver AppVersionGuard.
  MIN_APP_VERSION: z.string().optional(),
});

/** Textos que delatan un secreto de ejemplo copiado del `.env.example`. */
const PLACEHOLDER = /change[-_ ]?me|changeme|example|placeholder|replace[-_ ]?me|your[-_ ]?secret|secret123|password|dev[-_ ]?secret/i;

/**
 * S-4: en producción los secretos no pueden ser de ejemplo ni repetirse entre sí, y las claves de cifrado
 * son obligatorias (sin ellas el cifrado de PII queda a medias). En desarrollo y test no cambia nada.
 */
export const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  const fail = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const secrets = { JWT_SECRET: env.JWT_SECRET, JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET, FILE_LINK_SECRET: env.FILE_LINK_SECRET };
  for (const [name, value] of Object.entries(secrets)) {
    if (value && PLACEHOLDER.test(value)) fail(name, 'parece un secreto de ejemplo; genera uno aleatorio para producción');
  }
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) fail('JWT_REFRESH_SECRET', 'debe ser distinto de JWT_SECRET');
  if (env.FILE_LINK_SECRET && (env.FILE_LINK_SECRET === env.JWT_SECRET || env.FILE_LINK_SECRET === env.JWT_REFRESH_SECRET)) {
    fail('FILE_LINK_SECRET', 'debe ser distinto de los secretos del JWT');
  }
  if (!env.APP_ENCRYPTION_KEY) fail('APP_ENCRYPTION_KEY', 'es obligatoria en producción');
  if (!env.APP_BLIND_INDEX_KEY) fail('APP_BLIND_INDEX_KEY', 'es obligatoria en producción');
  if (env.APP_ENCRYPTION_KEY && env.APP_ENCRYPTION_KEY === env.APP_BLIND_INDEX_KEY) fail('APP_BLIND_INDEX_KEY', 'debe ser distinta de APP_ENCRYPTION_KEY');
});

export type Env = z.infer<typeof baseSchema>;

/** Validador usado por ConfigModule.forRoot({ validate }). Lanza → fail-fast. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ Configuración de entorno inválida:\n${detail}`);
  }
  return parsed.data;
}
