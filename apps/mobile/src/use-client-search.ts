/**
 * Buscador de clientes contra la API, con debounce. Vive acá porque lo usan **dos** pantallas
 * (el alta de agenda y la cartera) y la regla del BASE-INVENTORY es consolidar, no copiar.
 * Nació dentro de `app/agenda/crear.tsx`; los valores (300 ms, 2 caracteres) son los suyos, sin cambios.
 *
 * Sobre el `reqId`: el `clearTimeout` cancela el **temporizador**, no el `fetch` que ya salió. Sin el
 * contador, dos búsquedas seguidas pueden volver fuera de orden y dejar en pantalla los resultados de
 * la consulta vieja — raro en wifi, común en una conexión de campo.
 *
 * `unauthenticated` no se rutea acá: la pantalla que consume el hook ya está pidiendo sus propios datos
 * con la misma sesión y muestra ese estado. Un redirect desde un hook de búsqueda taparía ese mensaje.
 */
import { useEffect, useRef, useState } from 'react';
import { searchClients, type ClientHit } from './clients.service';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export function useClientSearch(query: string, opts: { enabled?: boolean } = {}): ClientHit[] {
  const { enabled = true } = opts;
  const [hits, setHits] = useState<ClientHit[]>([]);
  const reqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < MIN_CHARS) {
      reqRef.current++; // lo que esté en vuelo ya no debe pintar nada
      setHits((prev) => (prev.length ? [] : prev));
      return;
    }
    const reqId = ++reqRef.current;
    const timer = setTimeout(async () => {
      const res = await searchClients(q);
      if (reqId !== reqRef.current) return;
      setHits(res.status === 'ok' ? res.data : []);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, enabled]);

  return hits;
}
