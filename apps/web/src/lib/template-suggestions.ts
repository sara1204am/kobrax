import type { TemplateCategory } from '@kobrax/shared';

/**
 * Mensajes sugeridos por categoría y tono, para no empezar de cero. Solo usan las variables que el sistema llena
 * (`TEMPLATE_VARIABLES`): un texto de acá nunca deja un `{{…}}` suelto.
 *
 * En español fijo y no en i18n: es contenido PARA EL DEUDOR, no UI del panel, y las llaves de `{{cliente}}`
 * chocarían con el formato ICU de los mensajes. Cuando haya cuentas que escriban a deudores en otro idioma,
 * esto se vuelve un catálogo por idioma; hoy el producto cobra en español.
 */
export interface TemplateSuggestion {
  label: string;
  body: string;
}

/** Cuánta firmeza lleva el mensaje: de la cortesía a la exigencia, sin amenazas. */
export const TEMPLATE_TONES = ['AMABLE', 'FORMAL', 'FIRME'] as const;
export type TemplateTone = (typeof TEMPLATE_TONES)[number];

export const TEMPLATE_SUGGESTIONS: Record<TemplateCategory, Record<TemplateTone, TemplateSuggestion>> = {
  INITIAL: {
    AMABLE: {
      label: 'Primer contacto',
      body: 'Hola {{cliente}}, le saludamos de {{negocio}}. Notamos un saldo pendiente de {{saldo}}. ¿Podemos coordinar su pago? Estamos atentos en el {{telefono_negocio}}.',
    },
    FORMAL: {
      label: 'Pago vencido',
      body: 'Hola {{cliente}}, le escribimos de {{negocio}}. Su cuenta registra un saldo vencido de {{saldo}}. Le pedimos regularizarlo a la brevedad, o contactarnos para acordar una forma de pago.',
    },
    FIRME: {
      label: 'Saldo vencido',
      body: '{{cliente}}, {{negocio}} le informa que su cuenta mantiene un saldo vencido de {{saldo}}. Necesitamos que lo regularice esta semana. Comuníquese al {{telefono_negocio}}.',
    },
  },
  REMINDER: {
    AMABLE: {
      label: 'Recordatorio amable',
      body: 'Hola {{cliente}}, le saludamos de {{negocio}}. Le recordamos que tiene una cuota pendiente por {{saldo}}. Si ya realizó el pago, ignore este mensaje. ¡Gracias!',
    },
    FORMAL: {
      label: 'Vence pronto',
      body: 'Estimado/a {{cliente}}, le recordamos que su pago de {{saldo}} con {{negocio}} vence pronto. Quedamos atentos.',
    },
    FIRME: {
      label: 'Vencimiento próximo',
      body: '{{cliente}}, su pago de {{saldo}} con {{negocio}} vence en los próximos días. Le pedimos pagarlo a tiempo para mantener su cuenta al día. Consultas: {{telefono_negocio}}.',
    },
  },
  PROMISE: {
    AMABLE: {
      label: 'Recordar promesa',
      body: 'Hola {{cliente}}, ¡un recordatorio amistoso! Quedamos con {{negocio}} en que realizaría su pago de {{saldo}}. Si ya lo hizo, envíenos el comprobante. Si necesita cambiar la fecha, escríbanos al {{telefono_negocio}}.',
    },
    FORMAL: {
      label: 'Confirmar promesa',
      body: 'Hola {{cliente}}, le escribimos de {{negocio}} para confirmar su promesa de pago por {{saldo}}. ¿Nos confirma la fecha en que realizará el pago? Gracias.',
    },
    FIRME: {
      label: 'Promesa incumplida',
      body: '{{cliente}}, el pago de {{saldo}} que se comprometió a realizar con {{negocio}} no se registró. Le pedimos pagarlo hoy o comunicarse al {{telefono_negocio}} para acordar una nueva fecha.',
    },
  },
  LAST_NOTICE: {
    AMABLE: {
      label: 'Aviso amable',
      body: 'Hola {{cliente}}, queremos ayudarle a resolver su saldo de {{saldo}} con {{negocio}} antes de que pase a otra etapa. Escríbanos al {{telefono_negocio}} y buscamos una solución juntos.',
    },
    FORMAL: {
      label: 'Aviso antes de cobranza',
      body: 'Sr./Sra. {{cliente}}: este es el último aviso de {{negocio}} por su saldo de {{saldo}}. Para evitar acciones adicionales, comuníquese al {{telefono_negocio}}.',
    },
    FIRME: {
      label: 'Último aviso',
      body: 'Sr./Sra. {{cliente}}: su deuda de {{saldo}} con {{negocio}} sigue pendiente pese a los avisos anteriores. De no regularizarla en las próximas 48 horas, continuaremos con las acciones de cobranza que correspondan.',
    },
  },
  CONFIRMATION: {
    AMABLE: {
      label: 'Pago recibido',
      body: 'Hola {{cliente}}, ¡recibimos su pago! Muchas gracias por su puntualidad. — {{negocio}}',
    },
    FORMAL: {
      label: 'Saldo actualizado',
      body: 'Hola {{cliente}}, registramos su pago en {{negocio}}. Su saldo pendiente es {{saldo}}. Cualquier duda, escríbanos al {{telefono_negocio}}.',
    },
    FIRME: {
      label: 'Pago registrado',
      body: '{{cliente}}, {{negocio}} confirma que su pago fue registrado. Su saldo pendiente es {{saldo}}.',
    },
  },
};
