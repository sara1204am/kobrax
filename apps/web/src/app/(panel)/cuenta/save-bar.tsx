'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';

/** Lo que la barra necesita saber de cada formulario para decidir si aparece y si deja guardar. */
interface SectionState {
  dirty: boolean;
  saving: boolean;
  /** `false` = tiene errores de validación: guardar queda apagado hasta corregirlos. */
  valid: boolean;
}

interface SectionActions {
  /** `true` si guardó. El formulario muestra su propio error si falla. */
  save: () => Promise<boolean>;
  reset: () => void;
}

interface SaveBarContext {
  set: (id: string, state: SectionState, actions: SectionActions) => void;
  remove: (id: string) => void;
  hasUnsaved: boolean;
}

const Ctx = createContext<SaveBarContext | null>(null);

/**
 * Una barra de guardado para todos los formularios de la pestaña.
 *
 * Cada formulario se registra con `useSaveSection`; la barra aparece cuando alguno tiene cambios y
 * guarda **todos los que cambiaron** de una vez. Si uno falla, los demás quedan guardados y ese
 * formulario muestra su error en su sitio — la barra no esconde cuál fue.
 *
 * Sin proveedor, `useSaveSection` no hace nada y cada formulario conserva su propio botón.
 */
export function SaveBarProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('account.saveBar');
  const [states, setStates] = useState<Record<string, SectionState>>({});
  const actions = useRef(new Map<string, SectionActions>());
  const [busy, setBusy] = useState(false);

  const set = useCallback((id: string, state: SectionState, act: SectionActions) => {
    actions.current.set(id, act);
    setStates((prev) => {
      const old = prev[id];
      if (old && old.dirty === state.dirty && old.saving === state.saving && old.valid === state.valid) return prev;
      return { ...prev, [id]: state };
    });
  }, []);

  const remove = useCallback((id: string) => {
    actions.current.delete(id);
    setStates((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const dirtyIds = Object.keys(states).filter((id) => states[id].dirty);
  const hasUnsaved = dirtyIds.length > 0;
  const canSave = dirtyIds.every((id) => states[id].valid);
  const saving = busy || dirtyIds.some((id) => states[id].saving);

  // Recargar o cerrar la pestaña con cambios pendientes: el navegador pregunta. (Navegar por el menú
  // lateral no dispara esto; las pestañas de Cuenta sí piden confirmación por su cuenta.)
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);

  async function saveAll() {
    setBusy(true);
    try {
      await Promise.all(dirtyIds.map((id) => actions.current.get(id)?.save()));
    } finally {
      setBusy(false);
    }
  }

  function discardAll() {
    for (const id of dirtyIds) actions.current.get(id)?.reset();
  }

  const value = useMemo(() => ({ set, remove, hasUnsaved }), [set, remove, hasUnsaved]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {hasUnsaved && (
        <div
          role="region"
          aria-label={t('label')}
          className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-k-border bg-white px-5 py-3 shadow-k-card"
        >
          <p className="text-[14px] text-k-text">{canSave ? t('unsaved') : t('invalid')}</p>
          <div className="flex gap-2">
            <span className="w-28">
              <Button type="button" variant="ghost" className="!h-10" disabled={saving} onClick={discardAll}>
                {t('discard')}
              </Button>
            </span>
            <span className="w-44">
              <Button
                type="button"
                className="!h-10"
                loading={saving}
                disabled={!canSave}
                onClick={() => void saveAll()}
              >
                {t('save')}
              </Button>
            </span>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/**
 * Registra un formulario en la barra. Devuelve `managed`: si es `true`, la barra guarda por él y el
 * formulario no debe dibujar su botón.
 */
export function useSaveSection(id: string, section: SectionState & SectionActions): { managed: boolean } {
  const ctx = useContext(Ctx);
  // Las acciones cambian en cada render (cierran sobre el estado); la barra llama siempre a la última.
  const latest = useRef(section);
  latest.current = section;

  const { dirty, saving, valid } = section;
  useEffect(() => {
    ctx?.set(id, { dirty, saving, valid }, { save: () => latest.current.save(), reset: () => latest.current.reset() });
  }, [ctx, id, dirty, saving, valid]);

  useEffect(() => () => ctx?.remove(id), [ctx, id]);

  return { managed: ctx !== null };
}

/** ¿Hay cambios sin guardar? Para pedir confirmación antes de irse de la pestaña. */
export function useHasUnsaved(): boolean {
  return useContext(Ctx)?.hasUnsaved ?? false;
}
