/**
 * Configuración pública de la app, leída en un solo lugar.
 *
 * `APP_VERSION` se define únicamente en el `.env` raíz; `next.config.mjs` la expone al navegador como
 * `NEXT_PUBLIC_APP_VERSION`. Para un lanzamiento nuevo se cambia ahí y nada más.
 */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

/**
 * Canal de privacidad: donde las personas ejercen sus derechos y retiran consentimientos. Único lugar donde vive.
 * [PENDIENTE: migrar a un correo de dominio propio antes del lanzamiento; hoy es el que informó la titular.]
 */
export const PRIVACY_CONTACT_EMAIL = 'kobraxikigai@gmail.com';
