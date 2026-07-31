import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { formatInvitationCode } from '../../modules/auth/invitation-code';

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

export function passwordResetBody(params: { token: string; appUrl: string }): {
  subject: string;
  text: string;
} {
  return {
    subject: 'Recuperá tu contraseña de Kobrax',
    text: [
      'Pediste recuperar tu contraseña.',
      '',
      `Abrí este link desde tu teléfono:  kobrax://reset?token=${params.token}`,
      '',
      `Si el link no abre:  ${params.appUrl}/reset?token=${params.token}`,
      '',
      'El link vence en 30 minutos. Si no fuiste vos, ignorá este correo.',
    ].join('\n'),
  };
}
