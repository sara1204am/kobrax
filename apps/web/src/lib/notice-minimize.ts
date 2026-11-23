'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Avisos del panel que se pueden **minimizar** (facturación, confirmar correo).
 *
 * Minimizar vale para esta sesión: se guarda en `sessionStorage` y **se borra en cada login** (`clearMinimizedNotices`), así
 * que el aviso vuelve completo cada vez que se entra, hasta que se arregle lo que dice. Un aviso que se resolvió deja de
 * mostrarse por su propia condición (no faltan datos / el correo ya está confirmado), no por esto.
 */
const PREFIX = 'k_notice_min:';

export function clearMinimizedNotices(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* sessionStorage bloqueado: el aviso simplemente no recuerda */
  }
}

export function useMinimizedNotice(id: string): [boolean, (v: boolean) => void] {
  const [minimized, setMinimized] = useState(false);
  // Se lee después de montar: en el servidor no hay sessionStorage y el primer render tiene que coincidir.
  useEffect(() => {
    try {
      setMinimized(sessionStorage.getItem(PREFIX + id) === '1');
    } catch {
      /* ver arriba */
    }
  }, [id]);
  const set = useCallback(
    (v: boolean) => {
      setMinimized(v);
      try {
        if (v) sessionStorage.setItem(PREFIX + id, '1');
        else sessionStorage.removeItem(PREFIX + id);
      } catch {
        /* ver arriba */
      }
    },
    [id],
  );
  return [minimized, set];
}
