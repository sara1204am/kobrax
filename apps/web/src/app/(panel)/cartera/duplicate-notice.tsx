'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ClientDuplicateMatch } from '@kobrax/shared';
import { usePermissions } from '@/components/permissions';

/** Link a la ficha en otra pestaña: el alta a medio cargar no se pierde por ir a mirar. */
function OpenClient({ id }: { id: string }) {
  const t = useTranslations('portfolio.duplicate');
  return (
    <a href={`/cartera/${id}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
      {t('openClient')}
    </a>
  );
}

/**
 * El carnet ya es de alguien. **Bloquea**: el servidor rechazaría el alta igual (`CLIENT_DUP`), así
 * que se dice antes y se dice quién es, para que la persona vaya a su ficha en vez de reintentar.
 */
export function DocumentTaken({ match }: { match: ClientDuplicateMatch }) {
  const t = useTranslations('portfolio.duplicate');
  const { can } = usePermissions();
  return (
    <div role="alert" className="mt-1.5 text-[13px] text-k-danger">
      {match.hidden ? (
        // F14 · F2b (D-6, revisada): el cliente ya existe y lo llevan otras personas; con quien tiene `credit:create` se le ofrece
        // crear SU crédito sobre él (recién entonces lo ve).
        <>
          {t('documentTakenHidden', { name: match.displayName })}{' '}
          {can('credit:create') && (
            <Link href={`/cartera/${match.id}/prestamo`} className="font-medium text-k-periwinkle underline">
              {t('createMyCredit')}
            </Link>
          )}
        </>
      ) : match.deleted ? (
        t('documentTakenDeleted', { name: match.displayName })
      ) : (
        <>
          {t('documentTaken', { name: match.displayName })} {t('documentHint')} <OpenClient id={match.id} />
        </>
      )}
    </div>
  );
}

/**
 * Hay clientes que se llaman igual. **Avisa, no bloquea**: los homónimos existen, y quien está
 * cargando es quien sabe si es la misma persona. Para guardar tiene que decirlo con el check.
 */
export function NamesTaken({
  matches,
  accepted,
  onAccept,
  disabled,
}: {
  matches: ClientDuplicateMatch[];
  accepted: boolean;
  onAccept: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio.duplicate');
  return (
    <div role="status" className="mb-3 rounded-md border-l-[3px] border-k-warning bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">
      <p className="font-medium">{t('namesTitle', { n: matches.length })}</p>
      <p className="mt-0.5">{t('namesText')}</p>
      <ul className="mt-2 space-y-1">
        {matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{m.displayName}</span>
            <span>· {m.maskedDocument ?? t('noDocument')}</span>
            {m.otherDocument && <span>({t('otherDocument')})</span>}
            <span>· {t('credits', { n: m.creditCount })}</span>
            <OpenClient id={m.id} />
          </li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 font-medium">
        <input type="checkbox" checked={accepted} onChange={(e) => onAccept(e.target.checked)} disabled={disabled} />
        {t('acceptNames')}
      </label>
    </div>
  );
}
