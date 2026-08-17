'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Modal sobre el `<dialog>` nativo. **Todos van centrados**, angostos o anchos.
 *
 * `showModal()` regala **foco atrapado, tecla Esc, fondo inerte, backdrop y el centrado**: cinco
 * cosas que una implementación a mano hace peor y que son justo las que rompen la accesibilidad
 * cuando faltan. Lo único que se agrega es cerrar al tocar afuera, que el elemento no trae.
 *
 * 🔴 **El centrado es del navegador, no nuestro** (`margin: auto` sobre el diálogo del top layer):
 * por eso acá no hay una sola clase de posición. Un `m-0` o un `fixed` en el `shell` lo despega del
 * centro — es exactamente lo que hacía el cajón lateral que vivió acá un rato.
 *
 * `open` manda: el componente sigue la prop en vez de tener su propio estado, así el que abre
 * y el que cierra son el mismo. Esc y el clic afuera avisan por `onClose`.
 */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  shell,
  body,
}: DialogProps & { shell: string; body: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useTranslations('common');
  /**
   * Marca que el cierre lo pedimos nosotros.
   *
   * `dialog.close()` dispara el evento nativo `close`, que está cableado a `onClose` — así
   * que cerrar con la X llamaba a `onClose` **dos veces**: una por el clic y otra por el
   * cierre que ese clic provocó. Cualquier efecto del llamador (un toast, un `router.push`,
   * un POST que descarta un borrador) salía duplicado. El evento nativo sólo tiene que avisar
   * cuando quien cerró fue el navegador, o sea la tecla Esc.
   */
  const closingByCode = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      closingByCode.current = true;
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Por acá entra la tecla Esc, que cierra el diálogo sin pasar por ningún handler nuestro.
      onClose={() => {
        if (closingByCode.current) {
          closingByCode.current = false;
          return;
        }
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`border border-k-border bg-white p-0 text-k-text shadow-k-card backdrop:bg-k-navy/40 ${shell}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-transparent px-6 pt-5">
        <h2 id={titleId} className="text-[18px] font-semibold text-k-navy">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-k-muted hover:bg-k-bg hover:text-k-text-2"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className={body}>{children}</div>

      {actions && (
        <div className="flex flex-col-reverse gap-2 border-t border-k-border bg-white px-6 py-4 sm:flex-row sm:justify-end">
          {actions}
        </div>
      )}
    </dialog>
  );
}

/**
 * Sin `wide`: confirmar una baja, agregar un dato suelto. `wide`: un formulario entero —el alta de
 * cliente, una sección de la ficha— o mirar un documento del legajo.
 *
 * 🔴 **`max-h-[90vh]` + cuerpo con scroll propio, en los dos.** No es cosmética: **es lo que hace
 * que el modal quede en el medio**. El navegador centra un `<dialog>` repartiendo el espacio que le
 * sobra con `margin: auto`; si el contenido lo hace tan alto como la ventana no sobra nada, los
 * márgenes se resuelven en cero y el diálogo se pega **arriba**. Pasó con el visor de adjuntos: una
 * foto de carnet en vertical estiraba el modal hasta el borde y quedaba pegado al techo. Con un
 * techo de 90vh siempre sobra, y lo que no entra scrollea adentro en vez de empujar la caja.
 *
 * 🔴 **`hidden open:flex`, y nunca un `flex` suelto.** Un `<dialog>` cerrado se esconde por la hoja
 * del navegador (`display: none`), y **cualquier `display` que pongamos nosotros la pisa** — la
 * nuestra es hoja de autor y gana. Con un `flex` a secas, los tres modales de una pantalla —dar de
 * baja, quitar adjunto, ver en el mapa— aparecían **todos abiertos a la vez**, dibujados en el
 * medio del contenido y al pie. `open:` ata el `display` al atributo real del elemento, así que
 * también acierta cuando lo cierra el navegador con Esc.
 *
 * Lo único que cambia entre las dos variantes es el ancho y el tratamiento del texto: el angosto
 * lee como prosa (una pregunta de confirmación), el ancho como formulario.
 */
export function Modal({ wide, ...props }: DialogProps & { wide?: boolean }) {
  return (
    <Dialog
      {...props}
      shell={`hidden open:flex max-h-[90vh] flex-col rounded-2xl ${wide ? 'w-[880px] max-w-[94vw]' : 'w-[460px] max-w-[92vw]'}`}
      body={`flex-1 overflow-y-auto px-6 py-4 text-[14px] ${wide ? 'text-k-text' : 'leading-relaxed text-k-text-2'}`}
    />
  );
}

/*
 * Acá vivió `Drawer`, un panel pegado al borde derecho para editar una sección de la ficha. Se fue:
 * **todos los diálogos del panel van centrados**. Era el único que no, y un modal que a veces sale
 * del medio y a veces del costado obliga a buscar dónde apareció cada vez.
 */
