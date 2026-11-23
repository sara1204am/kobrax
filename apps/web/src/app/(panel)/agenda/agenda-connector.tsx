'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgendaItemType, type AgendaListItem, type Member } from '@kobrax/shared';
import { AgendaScreen } from './agenda-screen';
import { ItemActions } from './[id]/item-actions';
import type { CatalogOption } from './[id]/page';
import { NewTaskModal } from './new-task-modal';

/**
 * Qué pasa cuando la pantalla pide algo.
 *
 * 🔴 **Existe para que `AgendaScreen` no sepa navegar.** La pantalla emite «quiero ver la 42» o
 * «quiero crear una el martes a las 9»; acá se decide que eso es ir al detalle o al alta. Separarlo
 * en dos archivos parece de más hasta que la agenda se embebe en otra pantalla —el día de un
 * cobrador dentro de su ficha, por ejemplo— y ahí el contenedor es lo único que cambia.
 *
 * ponytail: hoy las acciones terminan en el detalle, que es donde ya viven completar,
 * reagendar y cancelar. Ejecutar una gestión desde la lista sin abrirla exige mostrar su resultado y
 * su nota, o sea el mismo formulario del detalle metido en un modal — dos lugares para lo mismo. Se
 * agrega el día que se mida que abrir el detalle es el cuello de botella, no antes.
 */
export function AgendaConnector(props: {
  day: string;
  today: string;
  items: AgendaListItem[];
  monthItems: AgendaListItem[];
  overdue: AgendaListItem[];
  overdueTotal: number;
  members: Member[];
  supervises: boolean;
  /** Quién puede asignar (`agenda:assign`) y quién es: habilita el selector «Asignar a» del alta. */
  assign?: { meId: string };
  /** Lo que necesitan los diálogos del menú «⋮» para abrirse aquí mismo. */
  dialogs?: { canWrite: boolean; cancelReasons: CatalogOption[]; rescheduleReasons: CatalogOption[]; reasons: CatalogOption[]; templates: CatalogOption[] };
}) {
  const router = useRouter();
  /** Con qué día y hora se abre el alta. `null` = cerrada. */
  const { assign, dialogs, ...screenProps } = props;
  /** Qué diálogo está abierto sobre la lista: la gestión y qué se le hace. */
  const [acting, setActing] = useState<{ id: string; action: 'complete' | 'reschedule' | 'cancel' | 'edit' | 'delete' } | null>(null);
  const actingItem = acting ? [...props.items, ...props.monthItems, ...props.overdue].find((i) => i.id === acting.id) : undefined;
  /** Abre el diálogo aquí; sin los catálogos (o sin la gestión a mano) cae al detalle, que ya sabe hacerlo. */
  const act = (id: string, action: NonNullable<typeof acting>['action'], accion: string) => {
    const it = [...props.items, ...props.monthItems, ...props.overdue].find((i) => i.id === id);
    // Una visita se completa desde su parada de ruta (GPS y evidencia): el detalle sabe mandarla ahí.
    if (!dialogs || !it || (action === 'complete' && it.type === AgendaItemType.VISIT)) return router.push(`/agenda/${id}?accion=${accion}`);
    setActing({ id, action });
  };
  const [creando, setCreando] = useState<{ date: string; time?: string } | null>(null);

  return (
    <>
      <AgendaScreen
        {...screenProps}
        events={{
          /*
           * 🔴 **Se agenda acá, no en otra pantalla.** Antes esto llevaba a la cartera con la idea de
           * que el alta era cosa del teléfono; pero quien supervisa agenda igual —acuerda una visita
           * por teléfono y la deja cargada—, y mandarla a buscar el cliente a otro lado para volver
           * era pedirle que arme el camino sola. El modal pide los mismos datos que el teléfono.
           */
          onCreateRequest: ({ date, time }) => setCreando({ date, time }),
          onViewRequest: (id) => router.push(`/agenda/${id}`),
          // Completar, reagendar y cancelar terminan en el detalle, que abre directo el diálogo pedido (`?accion=`).
          // 🔴 Los diálogos se abren AQUÍ, sobre la lista: antes el menú «⋮» abría el diálogo pero además llevaba al detalle.
          onCompleteRequest: (id) => act(id, 'complete', 'completar'),
          onRescheduleRequest: (id) => act(id, 'reschedule', 'reagendar'),
          onCancelRequest: (id) => act(id, 'cancel', 'cancelar'),
          onEditRequest: (id) => act(id, 'edit', 'editar'),
          onDeleteRequest: (id) => act(id, 'delete', 'eliminar'),
        }}
      />

      {/* Los diálogos de la gestión elegida en el menú «⋮». Se montan al abrir y se desmontan al cerrar: el borrador arranca limpio. */}
      {acting && actingItem && dialogs && (
        <ItemActions
          key={`${acting.id}:${acting.action}`}
          hideTriggers
          onClose={() => setActing(null)}
          itemId={actingItem.id}
          type={actingItem.type}
          clientId={actingItem.clientId}
          details={actingItem.details}
          initialAction={acting.action}
          today={props.today}
          cancelReasons={dialogs.cancelReasons}
          rescheduleReasons={dialogs.rescheduleReasons}
          canExecute={dialogs.canWrite}
          editable={dialogs.canWrite && actingItem.canEdit ? actingItem : undefined}
          schedule={{ timeMode: actingItem.timeMode, scheduledTime: actingItem.scheduledTime, timeSlot: actingItem.timeSlot }}
          assign={assign}
          reasons={dialogs.reasons}
          templates={actingItem.type === AgendaItemType.WHATSAPP ? dialogs.templates : []}
          initialTemplateCode={actingItem.type === AgendaItemType.WHATSAPP && typeof actingItem.details?.templateCode === 'string' ? actingItem.details.templateCode : undefined}
        />
      )}

      {/* Se monta al abrir: el borrador arranca limpio cada vez sin un solo efecto de reset. */}
      {creando && (
        <NewTaskModal open onClose={() => setCreando(null)} date={creando.date} time={creando.time} assign={assign} />
      )}
    </>
  );
}
