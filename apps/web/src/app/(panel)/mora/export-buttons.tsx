'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { moraExportQuery, type MoraExportFormat, type MoraParams } from '@/lib/mora';

/** El nombre del archivo que propone la API (`Content-Disposition`), o uno de respaldo. */
function filenameOf(disposition: string | null, fallback: string): string {
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

/**
 * «Exportar CSV» y «Exportar PDF»: bajan **exactamente lo que se está viendo**.
 *
 * 🔴 **La query sale de la URL de la tabla**, por la misma función que arma la de la lista (`moraExportQuery`):
 * no hay un estado de filtros aparte que pueda quedar desfasado. Búsqueda, filtros y orden viajan; la página
 * no — se baja todo el resultado. El alcance lo pone la API con la sesión.
 *
 * Se baja con `fetch` y no con un enlace para poder mostrar el error: si el filtro devuelve más créditos que
 * el tope, la API explica qué hacer, y un enlace mostraría un JSON crudo en otra pestaña.
 */
export function ExportButtons() {
  const t = useTranslations('panel.cases.export');
  const toast = useToast();
  const search = useSearchParams();
  const [busy, setBusy] = useState<MoraExportFormat | null>(null);

  async function download(format: MoraExportFormat) {
    setBusy(format);
    try {
      const params = Object.fromEntries(search.entries()) as MoraParams;
      const query = moraExportQuery(params);
      query.set('format', format);
      const res = await fetch(`/api/mora/export?${query}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast(body?.error?.message ?? t('error'), 'danger');
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filenameOf(res.headers.get('content-disposition'), `creditos-en-mora.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch {
      toast(t('error'), 'danger');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2" title={t('hint')}>
      {(['csv', 'pdf'] as const).map((format) => (
        <Button
          key={format}
          type="button"
          variant="ghost"
          loading={busy === format}
          disabled={busy !== null}
          onClick={() => download(format)}
          className="h-9 text-[13px] sm:w-auto sm:px-3"
        >
          {busy === format ? t('working') : t(format)}
        </Button>
      ))}
    </div>
  );
}
