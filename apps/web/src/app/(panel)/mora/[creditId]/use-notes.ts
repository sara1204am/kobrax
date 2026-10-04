'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { CreditNote, MoraNoteAnchor, MoraNoteColor, MoraNoteKind, UpdateCreditNote } from '@kobrax/shared';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * El estado de las notas de la ficha: **una sola fuente** para el listado de tarjetas y para el tablero de
 * post-its. Lo que se cambia se ve al instante (optimista) y se guarda con un PATCH; si la API lo rechaza, se
 * vuelve a como estaba y se avisa — nunca queda en pantalla algo que no se guardó.
 */
export function useNotes(creditId: string, initial: CreditNote[] | null) {
  const t = useTranslations('panel.cases.ficha.notes');
  const tErr = useTranslations('panel.cases');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [notes, setNotes] = useState<CreditNote[]>(initial ?? []);
  // Un id por nota que se está escribiendo: si el envío falla y se reintenta (o doble clic), viaja el mismo.
  const pendingId = useRef<string | null>(null);

  // El servidor manda una lista nueva después de `router.refresh()`: manda lo suyo.
  useEffect(() => setNotes(initial ?? []), [initial]);

  const replace = useCallback((note: CreditNote) => setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n))), []);

  const fail = useCallback(
    (error: Parameters<typeof errorText>[0]) => toast(errorText(error, tErr, locale), 'danger'),
    [toast, tErr, locale],
  );

  /** Lo que se ve ya, sin guardar: se usa mientras se arrastra. */
  const preview = replace;

  /**
   * Guarda un cambio. `before` es lo que había: si la API lo rechaza (sin permiso, nota ya borrada…) se vuelve ahí.
   * Devuelve si quedó guardado.
   */
  const save = useCallback(
    async (before: CreditNote, patch: UpdateCreditNote): Promise<boolean> => {
      const res = await sendJson<CreditNote>(`/api/mora/${creditId}/notes/${before.id}`, patch, 'PATCH');
      if (!res.ok) {
        replace(before);
        fail(res.data.error);
        return false;
      }
      if (res.data.id) replace(res.data);
      return true;
    },
    [creditId, replace, fail],
  );

  const create = useCallback(
    async (input: { body: string; kind: MoraNoteKind; color: MoraNoteColor; anchor?: MoraNoteAnchor; x?: number; y?: number }): Promise<CreditNote | null> => {
      pendingId.current ??= crypto.randomUUID();
      const res = await sendJson<CreditNote>(`/api/mora/${creditId}/notes`, { id: pendingId.current, ...input }, 'POST');
      if (!res.ok) {
        fail(res.data.error);
        return null;
      }
      pendingId.current = null;
      setNotes((prev) => [res.data, ...prev.filter((n) => n.id !== res.data.id)]);
      toast(t('saved'));
      router.refresh();
      return res.data;
    },
    [creditId, fail, router, t, toast],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await sendJson(`/api/mora/${creditId}/notes/${id}`, undefined, 'DELETE');
      if (!res.ok) {
        fail(res.data.error);
        return false;
      }
      setNotes((prev) => prev.filter((n) => n.id !== id));
      toast(t('deleted'));
      router.refresh();
      return true;
    },
    [creditId, fail, router, t, toast],
  );

  return { notes, preview, save, create, remove };
}
