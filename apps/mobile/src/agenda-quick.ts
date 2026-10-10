import { AgendaItemStatus, AgendaItemType, whatsappLink, type AgendaItemDetail } from '@kobrax/shared';
import { actionLinks } from './agenda.service';

/**
 * Las acciones rápidas de una fila de la lista de agenda (F4/11 · E6): llamar, abrir WhatsApp o navegar SIN abrir el detalle.
 *
 * 🔴 **La lista no trae teléfono ni dirección, a propósito** (se revelan y se auditan solo en el detalle). Por eso las acciones salen
 * del detalle que la hidratación ya bajó al teléfono: una gestión que nunca se bajó simplemente no muestra acciones y hay que abrirla.
 *
 * Una acción por tipo —lo que esa gestión pide hacer—:
 *  · Llamada → Llamar · WhatsApp → WhatsApp (con el mensaje escrito) · Visita → Navegar · Recordatorio y promesa → ninguna.
 *
 * Abrir cualquiera de las tres NO registra nada: la ejecución se registra aparte, con su resultado.
 */
export type QuickKind = 'tel' | 'wa' | 'nav';

export interface QuickAction {
  kind: QuickKind;
  label: string;
  icon: string;
  /** Lo que abre el sistema (`tel:`, `wa.me`, mapa). `nav` no lleva url: abre el mapa de Kobrax. */
  url?: string;
}

export function quickActions(
  type: AgendaItemType,
  status: AgendaItemStatus,
  detail: Pick<AgendaItemDetail, 'target' | 'item'> | null | undefined,
  platform: string = 'android',
): QuickAction[] {
  if (status !== AgendaItemStatus.SCHEDULED || !detail?.target) return [];
  const { tel, geo } = actionLinks(detail.target, platform);

  if (type === AgendaItemType.CALL && tel) return [{ kind: 'tel', label: 'Llamar', icon: '📞', url: tel }];
  if (type === AgendaItemType.WHATSAPP && detail.target.phone) {
    const message = typeof detail.item?.details?.message === 'string' ? detail.item.details.message : undefined;
    return [{ kind: 'wa', label: 'WhatsApp', icon: '💬', url: whatsappLink(detail.target.phone, message) }];
  }
  if (type === AgendaItemType.VISIT && geo) return [{ kind: 'nav', label: 'Navegar', icon: '🧭' }];
  return [];
}
