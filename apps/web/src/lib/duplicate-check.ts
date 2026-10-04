import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientDuplicateCheck, ClientDuplicateCheckInput, ClienteForm } from '@kobrax/shared';

/** Freno entre tecla y consulta: sin él cada letra es un viaje al servidor. */
export const DUPLICATE_DEBOUNCE_MS = 400;

/**
 * Qué se le pregunta al servidor con lo escrito hasta ahora, o `null` si todavía no hay nada que
 * valga la pena preguntar: un carnet de menos de 3 caracteres, o un nombre sin apellido («Juan»
 * solo coincide con media cartera — el servidor tampoco busca por nombre así).
 */
export function duplicateCheckInput(form: ClienteForm): ClientDuplicateCheckInput | null {
  const nationalId = form.nationalId.trim();
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const businessName = form.businessName.trim();
  const docReady = nationalId.length >= 3;
  const nameReady = form.clientType === 'COMPANY' ? businessName.length >= 2 : firstName.length >= 2 && lastName.length >= 2;
  if (!docReady && !nameReady) return null;
  return form.clientType === 'COMPANY'
    ? { clientType: 'COMPANY', ...(docReady ? { nationalId } : {}), ...(nameReady ? { businessName } : {}) }
    : { clientType: 'PERSON', ...(docReady ? { nationalId } : {}), ...(nameReady ? { firstName, lastName } : {}) };
}

/**
 * El nombre tal como se confirmó «es otra persona». Si el nombre cambia, la confirmación ya no vale:
 * se confirmó para otro nombre y otros homónimos.
 */
export function nameSignature(form: ClienteForm): string {
  const raw = form.clientType === 'COMPANY' ? form.businessName : `${form.firstName} ${form.lastName}`;
  return `${form.clientType}:${raw.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** ¿Se puede guardar con este resultado? El carnet bloquea; los homónimos, hasta que se confirme. */
export function duplicateBlocks(check: ClientDuplicateCheck | null, namesAccepted: boolean): 'document' | 'names' | null {
  if (!check) return null;
  if (check.document) return 'document';
  if (check.names.length > 0 && !namesAccepted) return 'names';
  return null;
}

async function ask(input: ClientDuplicateCheckInput, signal?: AbortSignal): Promise<ClientDuplicateCheck | null> {
  const res = await fetch('/api/clients/duplicate-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as ClientDuplicateCheck | null;
  return body && Array.isArray(body.names) ? body : null;
}

/**
 * Pregunta por posibles duplicados mientras se escribe.
 *
 * 🔴 **Cada consulta nueva aborta la anterior.** Sin eso las respuestas vuelven desordenadas: la de
 * «Pér» puede llegar después de la de «Pérez» y pisar el aviso bueno con uno viejo.
 *
 * Si el chequeo falla (sin red, 500) no se inventa nada: el resultado queda en `null` y el alta
 * sigue. El carnet lo vuelve a frenar el servidor al guardar (`CLIENT_DUP`).
 */
export function useDuplicateCheck(form: ClienteForm) {
  const input = duplicateCheckInput(form);
  const key = input ? JSON.stringify(input) : '';
  const [result, setResult] = useState<ClientDuplicateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    inflight.current?.abort();
    if (!key) {
      setResult(null);
      setChecking(false);
      return;
    }
    const ctrl = new AbortController();
    inflight.current = ctrl;
    const id = setTimeout(async () => {
      setChecking(true);
      const res = await ask(JSON.parse(key) as ClientDuplicateCheckInput, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setResult(res);
      setChecking(false);
    }, DUPLICATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [key]);

  /** Sin esperar el freno: lo usa «Guardar», que no puede decidir con una respuesta vieja. */
  const checkNow = useCallback(async (): Promise<ClientDuplicateCheck | null> => {
    if (!key) return null;
    inflight.current?.abort();
    const res = await ask(JSON.parse(key) as ClientDuplicateCheckInput);
    setResult(res);
    setChecking(false);
    return res;
  }, [key]);

  return { result, checking, checkNow };
}
