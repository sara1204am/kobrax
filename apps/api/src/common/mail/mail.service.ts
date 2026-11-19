import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { formatInvitationCode } from '../../modules/auth/invitation-code';
import { mailBlockReason } from './mail-guard';

/**
 * Envío de correo (CUENTA · S2-D1). Un transport, un `sendMail`, y los cuerpos como
 * funciones puras. **Sin cola, sin reintentos, sin motor de plantillas.**
 *
 * Cierra un agujero histórico que no es de este módulo: `forgot-password` generaba el
 * token y no lo enviaba a ningún lado desde siempre. El service lo usan la invitación
 * **y** el reset — es el mismo agujero, no dos.
 *
 * `ponytail:` SMTP es un socket, no un `POST`, así que `fetch` no alcanza y entra
 * `nodemailer`. Techo conocido: Gmail limita ~500 envíos/día y puede marcar spam;
 * cuando moleste se cambia el transport, que es el único lugar que sabe cómo se envía.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private readonly config: AppConfigService) {}

  /**
   * Sin credenciales SMTP **loguea en vez de enviar** — igual que hacía `forgot-password`
   * en dev. Así todo el módulo se construye y se prueba sin tocar el `.env`, y ningún
   * test manda un correo de verdad.
   */
  async send(to: string, subject: string, text: string): Promise<void> {
    const { smtpUser, smtpPass, mailFrom } = this.config;
    // Guardia: a direcciones de prueba, o desde un entorno de pruebas, **nunca** se envía de verdad (ver `mail-guard.ts`).
    const blocked = mailBlockReason(to, process.env);
    if (blocked) {
      this.logger.warn(`[ENVÍO BLOQUEADO: ${blocked}] Para: ${to} · ${subject}`);
      return;
    }
    if (!smtpUser || !smtpPass) {
      this.logger.warn(`[SIN SMTP] Para: ${to} · ${subject}\n${text}`);
      return;
    }
    this.transporter ??= createTransport({
      service: 'gmail',
      auth: { user: smtpUser, pass: smtpPass },
    });
    await this.transporter.sendMail({ from: mailFrom ?? smtpUser, to, subject, text });
  }
}

/**
 * El correo lleva **las dos** formas de entrar (S2-D3): el link, que es cómodo si la app
 * está instalada, y el código escrito, que es el que siempre funciona — con Expo Go el
 * esquema es `exp://` y desde Gmail un `kobrax://` puede no abrir nada.
 */
export function invitationBody(params: {
  businessName: string;
  invitedBy: string;
  code: string;
}): { subject: string; text: string } {
  const pretty = formatInvitationCode(params.code);
  return {
    subject: `${params.invitedBy} te invitó a ${params.businessName} en Kobrax`,
    text: [
      `${params.invitedBy} te invitó a trabajar en ${params.businessName} con Kobrax.`,
      '',
      `Abrí este link desde tu teléfono:  kobrax://invitacion?c=${params.code}`,
      '',
      'Si el link no abre, entrá a la app, tocá "Tengo una invitación" y escribí este código:',
      '',
      `    ${pretty}`,
      '',
      'El código vence en 7 días y sirve una sola vez.',
    ].join('\n'),
  };
}

/**
 * Sin respaldo web a propósito: `APP_URL` no sirve ninguna página de reset todavía, y un
 * link muerto en un correo de recuperación es peor que no ponerlo. Cuando exista la web,
 * se agrega acá.
 */
export function passwordResetBody(token: string): { subject: string; text: string } {
  return {
    subject: 'Recuperá tu contraseña de Kobrax',
    text: [
      'Pediste recuperar tu contraseña.',
      '',
      `Abrí este link desde tu teléfono:  kobrax://reset?token=${token}`,
      '',
      'El link vence en 30 minutos. Si no fuiste vos, ignorá este correo.',
    ].join('\n'),
  };
}

/** Cómo se dice cada tipo de solicitud pública a la PERSONA (nunca el código interno) y al equipo de Kobrax. */
const REPORT_KIND: Record<string, { person: string; staff: string }> = {
  ACCOUNT_DELETION: { person: 'eliminar tu cuenta de Kobrax', staff: 'Eliminar cuenta' },
  ERASURE: { person: 'eliminar tus datos', staff: 'Eliminar datos' },
  ACCESS: { person: 'saber qué datos tuyos tiene Kobrax', staff: 'Acceso a datos' },
  RECTIFICATION: { person: 'corregir tus datos', staff: 'Corregir datos' },
  OBJECTION: { person: 'oponerte al uso de tus datos', staff: 'Oposición' },
  ABUSE_REPORT: { person: 'reportar un abuso', staff: 'Reporte de abuso' },
  OTHER: { person: 'tu consulta', staff: 'Otra consulta' },
};
const kindOf = (kind: string) => REPORT_KIND[kind] ?? { person: 'tu solicitud', staff: kind };

/** Correo a quien pide algo por el formulario público: confirma que el correo es suyo antes de que se actúe sobre sus datos o su cuenta. */
export function publicReportVerifyBody(params: { link: string; kind: string }): { subject: string; text: string } {
  const what = kindOf(params.kind).person;
  return {
    subject: 'Confirma tu solicitud en Kobrax',
    text: [
      `Recibimos tu solicitud de ${what}, hecha con este correo en Kobrax.`,
      '',
      'Para que podamos atenderla, confirma que fuiste tú abriendo este enlace y pulsando "Confirmar":',
      '',
      `    ${params.link}`,
      '',
      'Confirmar no ejecuta nada por sí solo: después revisaremos que la solicitud sea tuya y te responderemos a este correo antes de hacer cambios.',
      '',
      'El enlace vence en 48 horas y sirve una sola vez. Si no fuiste tú, ignora este correo: no se hará nada.',
    ].join('\n'),
  };
}

/** Aviso interno a Kobrax: llegó un reporte o una solicitud por el formulario público. */
export function publicReportNotifyBody(params: {
  reference: string;
  kind: string;
  contactEmail: string;
  contactName: string | null;
  reportedSubject: string | null;
  description: string;
  needsVerification: boolean;
  event: 'received' | 'verified';
  /** Dirección completa de la consola de plataforma, para abrirla desde el correo. */
  consoleUrl: string;
}): { subject: string; text: string } {
  const label = kindOf(params.kind).staff;
  const head = params.event === 'verified' ? `Correo confirmado · ${label} · ${params.reference}` : `Nuevo reporte · ${label} · ${params.reference}`;
  return {
    subject: `[Kobrax] ${head}`,
    text: [
      params.event === 'verified' ? 'La persona confirmó que el correo es suyo.' : 'Llegó un reporte o solicitud por el formulario público.',
      '',
      `Tipo:       ${label} (${params.kind})`,
      `Código:     ${params.reference}`,
      `Contacto:   ${params.contactName ? `${params.contactName} <${params.contactEmail}>` : params.contactEmail}`,
      `Se refiere: ${params.reportedSubject ?? '(no indicó)'}`,
      `Correo:     ${params.needsVerification ? (params.event === 'verified' ? 'CONFIRMADO' : 'PENDIENTE de confirmar (no actuar hasta que confirme)') : 'no requiere confirmación'}`,
      '',
      params.description,
      '',
      `Atiéndelo desde la consola de plataforma: ${params.consoleUrl}`,
    ].join('\n'),
  };
}

/** Correo al crear la cuenta: confirma que el correo es de quien se registró. */
export function emailVerificationBody(link: string): { subject: string; text: string } {
  return {
    subject: 'Confirma tu correo en Kobrax',
    text: [
      'Creaste una cuenta en Kobrax con este correo.',
      '',
      'Confirma que es tuyo abriendo este enlace y pulsando "Confirmar":',
      '',
      `    ${link}`,
      '',
      'El enlace vence en 48 horas y sirve una sola vez. Si no creaste la cuenta, ignora este correo.',
    ].join('\n'),
  };
}
