'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ATTACHMENT_TYPES, type ClientAttachmentDetail } from '@kobrax/shared';
import { Icon } from '@/components/panel-shell';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { Button, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { postJson, sendJson } from '@/lib/client';
import { date } from '@/lib/format';

/**
 * Los adjuntos del legajo: CI, certificados de trabajo, facturas de servicios.
 *
 * 🔴 **Ahora se pueden abrir.** La API ocultaba la URL esperando el endpoint firmado de F6, y el
 * resultado fue un legajo que se podía llenar y nunca mirar — lo único que un legajo tiene que dejar
 * hacer. La URL es interna (`/api/uploads/<hash>.<ext>`): la sirve el proxy del BFF con la sesión de
 * quien mira y **sólo dentro de su empresa**.
 *
 * De un adjunto se corrige **qué es**, no el archivo: el hash es la prueba de que no cambió, así que
 * reemplazarlo es subir otro y borrar éste. Clasificarlo mal, en cambio, pasa siempre — se sube el
 * carnet apurado, queda como «Otro», y después nadie encuentra el carnet.
 *
 * Es componente de cliente por la subida y el visor. Tiene su propio `busy` en vez de compartir el
 * de la ficha: subir un archivo no tiene por qué apagar el botón de revelar.
 */
export function AttachmentsSection({
  clientId,
  rows,
  canWrite,
}: {
  clientId: string;
  rows: ClientAttachmentDetail[];
  canWrite: boolean;
}) {
  const t = useTranslations('portfolio');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [encima, setEncima] = useState(false);
  const [viendo, setViendo] = useState<ClientAttachmentDetail | null>(null);
  const [borrando, setBorrando] = useState<ClientAttachmentDetail | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  async function subir(file: File) {
    setBusy(true);
    // Dos pasos porque son dos cosas: guardar el archivo y decir de quién es. El primero es el
    // mismo `POST /uploads` que W2 usa para la foto de perfil.
    const data = new FormData();
    data.append('file', file);
    const subida = await fetch('/api/account/upload', { method: 'POST', body: data });
    const stored = (await subida.json().catch(() => ({}))) as { url?: string; hash?: string; error?: { message: string } };
    if (!subida.ok || !stored.url) {
      setBusy(false);
      return toast(stored.error?.message ?? t('uploadError'), 'danger');
    }

    const { ok, data: res } = await postJson(`/api/clients/${clientId}/attachments`, {
      fileType: 'OTHER',
      fileUrl: stored.url,
      fileHash: stored.hash,
    });
    setBusy(false);
    if (!ok) return toast(res.error?.message ?? t('uploadError'), 'danger');
    // Entra como «Otro» y se clasifica desde la fila: pedir el tipo antes de ver el archivo es
    // pedirle a alguien que adivine cuál de los cuatro PDFs acaba de arrastrar.
    toast(t('uploaded'));
    router.refresh();
  }

  async function borrar(a: ClientAttachmentDetail) {
    setBusy(true);
    const { ok, data } = await sendJson(`/api/clients/${clientId}/attachments/${a.id}`, null, 'DELETE');
    setBusy(false);
    setBorrando(null);
    if (!ok) return toast(data.error?.message ?? t('actionError'), 'danger');
    toast(t('attachmentRemoved'));
    router.refresh();
  }

  async function reclasificar(aid: string, fileType: string) {
    setBusy(true);
    const { ok, data } = await sendJson(`/api/clients/${clientId}/attachments/${aid}`, { fileType }, 'PATCH');
    setBusy(false);
    setEditando(null);
    if (!ok) return toast(data.error?.message ?? t('actionError'), 'danger');
    toast(t('saved'));
    router.refresh();
  }

  /**
   * Soltar archivos encima. Es la API nativa de HTML5 —`onDragOver` + `onDrop`—: ninguna dependencia
   * por algo que el navegador ya hace.
   *
   * 🔴 El `preventDefault` del `dragOver` **no es opcional**: sin él, el navegador rechaza la
   * soltada y —peor— abre el archivo en la pestaña, tirando la pantalla que la persona tenía.
   */
  const dropzone = canWrite
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setEncima(true);
        },
        onDragLeave: () => setEncima(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setEncima(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void subir(file);
        },
      }
    : {};

  return (
    <>
      <Section
        title={t('sections.attachments')}
        action={canWrite ? <SubirLabel busy={busy} onFile={subir} label={busy ? t('uploading') : t('addAttachment')} /> : undefined}
      >
        {rows.length === 0 ? (
          <div
            {...dropzone}
            className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              encima ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border'
            }`}
          >
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-k-bg text-k-muted">
              <Icon name="file" className="h-6 w-6" />
            </span>
            <p className="text-[15px] font-medium text-k-text">{t('noAttachments')}</p>
            {/* 🔴 El vacío ENSEÑA qué subir. «Sin adjuntos» a secas deja el legajo vacío para siempre:
                nadie sabe qué se espera de esa caja. */}
            <p className="mx-auto mt-1 max-w-[380px] text-[13px] text-k-text-2">{t('attachmentsEmptyHint')}</p>
          </div>
        ) : (
          <>
            <ul {...dropzone} className={`divide-y divide-k-border rounded-xl ${encima ? 'bg-k-highlight' : ''}`}>
              {rows.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  {/*
                   * La miniatura es el archivo mismo. 🔴 Con `loading="lazy"`: un legajo de veinte
                   * adjuntos bajaba veinte imágenes completas para pintar veinte cuadraditos.
                   */}
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-k-bg text-k-muted">
                    {a.fileUrl ? (
                      <img src={a.fileUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <Icon name="file" className="h-[18px] w-[18px]" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    {editando === a.id ? (
                      // El desplegable guarda al elegir: son cuatro opciones y un botón «Guardar»
                      // al lado sería un segundo clic para confirmar lo que ya se decidió.
                      <Select
                        autoFocus
                        defaultValue={a.fileType}
                        disabled={busy}
                        onChange={(e) => void reclasificar(a.id, e.target.value)}
                        onBlur={() => setEditando(null)}
                        className="h-9 max-w-[220px] text-[13px]"
                        aria-label={t('form.attachmentType')}
                      >
                        {ATTACHMENT_TYPES.map((v) => (
                          <option key={v} value={v}>
                            {t(`attachmentType.${v}`)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="block text-[14px] font-medium text-k-text">{t(`attachmentType.${a.fileType}`)}</span>
                    )}
                    <span className="block truncate text-[12px] text-k-muted">
                      {date(a.createdAt, locale)}
                      {/* El hash es lo que prueba que el archivo no cambió. Corto: entero son 64
                          caracteres que nadie compara a ojo. */}
                      {a.fileHash && ` · ${a.fileHash.slice(0, 12)}…`}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-3 text-[13px] font-medium">
                    {a.fileUrl && (
                      <>
                        <button type="button" onClick={() => setViendo(a)} className="text-k-periwinkle hover:underline">
                          {t('preview')}
                        </button>
                        {/*
                         * 🔴 `<a download>` y no un `fetch` + blob: el navegador ya sabe descargar, y
                         * el nombre sale del hash, que es como está guardado. Es un link de verdad —
                         * se abre en otra pestaña con clic del medio y se copia la dirección.
                         */}
                        <a href={a.fileUrl} download className="text-k-periwinkle hover:underline">
                          {t('download')}
                        </a>
                      </>
                    )}
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditando(a.id)}
                          disabled={busy}
                          className="text-k-periwinkle hover:underline disabled:opacity-50"
                        >
                          {t('edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setBorrando(a)}
                          disabled={busy}
                          className="text-k-danger hover:underline disabled:opacity-50"
                        >
                          {t('form.remove')}
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-k-muted">{t('attachmentsHint')}</p>
          </>
        )}
      </Section>

      {/*
       * El visor. Un adjunto del legajo es una foto o un escaneo: abrirlo en una pestaña nueva
       * pierde la ficha, y el modal nativo ya trae Esc y clic afuera.
       *
       * 🔴 **Ancho.** Es un carnet o un contrato: lo que se viene a hacer acá es *leerlo*, y en la
       * caja angosta de una confirmación un documento escaneado no se lee. La imagen no lleva
       * `max-h`: el techo lo pone el modal (90vh) y lo que sobre scrollea — un `max-h` acá la
       * achicaría para que entre, que es justo lo contrario de poder mirarla.
       */}
      <Modal
        wide
        open={viendo !== null}
        onClose={() => setViendo(null)}
        title={viendo ? t(`attachmentType.${viendo.fileType}`) : t('sections.attachments')}
      >
        {viendo?.fileUrl && <img src={viendo.fileUrl} alt="" className="mx-auto w-auto max-w-full rounded-lg" />}
      </Modal>

      {/*
       * 🔴 Borrar un adjunto **pregunta**. No hay papelera: el archivo se va del legajo y el hash con
       * él, que es justo lo que probaba que ese documento existió. Antes salía con un solo clic, al
       * lado de un botón de descarga.
       */}
      <Modal
        open={borrando !== null}
        onClose={() => setBorrando(null)}
        title={t('confirmAttachmentRemove.title')}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setBorrando(null)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button loading={busy} onClick={() => borrando && void borrar(borrando)}>
                {t('confirmAttachmentRemove.ok')}
              </Button>
            </span>
          </>
        }
      >
        {t('confirmAttachmentRemove.text')}
      </Modal>
    </>
  );
}

/** El `<input type="file">` nativo, escondido detrás de un label. Ninguna dependencia. */
function SubirLabel({ busy, onFile, label }: { busy: boolean; onFile: (f: File) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-k-periwinkle hover:underline">
      <Icon name="upload" className="h-4 w-4" />
      {label}
      <input
        type="file"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // permite volver a elegir el mismo archivo
          if (file) onFile(file);
        }}
      />
    </label>
  );
}
