'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgendaListItem, Member } from '@kobrax/shared';
import { AgendaScreen } from './agenda-screen';
import { NewTaskModal } from './new-task-modal';

/**
 * Qué pasa cuando la pantalla pide algo.
 *
 * 🔴 **Existe para que `AgendaScreen` no sepa navegar.** La pantalla emite «quiero ver la 42» o
 * «quiero crear una el martes a las 9»; acá se decide que eso es ir al detalle o al alta. Separarlo
 * en dos archivos parece de más hasta que la agenda se embebe en otra pantalla —el día de un
 * cobrador dentro de su ficha, por ejemplo— y ahí el contenedor es lo único que cambia.
 *
 * ponytail: hoy las cuatro acciones terminan en el detalle, que es donde ya viven completar,
 * reagendar y cancelar. Ejecutar una gestión desde la lista sin abrirla exige mostrar su resultado y
 * su nota, o sea el mismo formulario del detalle metido en un modal — dos lugares para lo mismo. Se
 * agrega el día que se mida que abrir el detalle es el cuello de botella, no antes.
 */
export function AgendaConnector(props: {
  day: string;
  today: string;
  items: AgendaListItem[];
  weekItems: AgendaListItem[];
  monthItems: AgendaListItem[];
  overdue: AgendaListItem[];
  overdueTotal: number;
  members: Member[];
  supervises: boolean;
}) {
  const router = useRouter();
  /** Con qué día y hora se abre el alta. `null` = cerrada. */
  const [creando, setCreando] = useState<{ date: string; time?: string } | null>(null);

  return (
    <>
      <AgendaScreen
        {...props}
        events={{
          /*
           * 🔴 **Se agenda acá, no en otra pantalla.** Antes esto llevaba a la cartera con la idea de
           * que el alta era cosa del teléfono; pero quien supervisa agenda igual —acuerda una visita
           * por teléfono y la deja cargada—, y mandarla a buscar el cliente a otro lado para volver
           * era pedirle que arme el camino sola. El modal pide los mismos datos que el teléfono.
           */
          onCreateRequest: ({ date, time }) => setCreando({ date, time }),
          onViewRequest: (id) => router.push(`/agenda/${id}`),
          // Completar y llamar terminan en el detalle: es donde están el resultado y el teléfono.
          onCompleteRequest: (id) => router.push(`/agenda/${id}?accion=completar`),
          onCallRequest: (id) => router.push(`/agenda/${id}?accion=llamar`),
        }}
      />

      {/* Se monta al abrir: el borrador arranca limpio cada vez sin un solo efecto de reset. */}
      {creando && (
        <NewTaskModal open onClose={() => setCreando(null)} date={creando.date} time={creando.time} />
      )}
    </>
  );
}
