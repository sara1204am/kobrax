'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/panel-ui';
import type { CursorPage, MemberActivityEvent, MemberConnection } from '@kobrax/shared';
import { whenLabel } from '../when';
import { InfiniteTable } from './infinite-table';

/** Acciones del panel con nombre propio. Cualquier otra se dice genérica: no se inventa lo que no se sabe. */
const ADMIN_VERBS = ['CREATE', 'UPDATE', 'DELETE', 'ASSIGN', 'GENERATE'];
const ADMIN_ENTITIES = [
  'user_account',
  'payment',
  'credit',
  'credit_note',
  'client',
  'client_contact',
  'route',
  'route_stop',
  'agenda_item',
  'field_visit',
  'dashboard',
  'upload',
];

/** La actividad de un miembro, de la más nueva a la más vieja, con scroll infinito. */
export function ActivityTable({
  userId,
  days,
  initial,
}: {
  userId: string;
  days: number;
  initial: CursorPage<MemberActivityEvent>;
}) {
  const t = useTranslations('team.detail');
  const tw = useTranslations('team.lastAccess');
  const locale = useLocale();

  // Las claves de verbo y entidad llegan de la API y se validan contra las listas de arriba: el traductor tipado no las conoce.
  const loose = t as unknown as (key: string, values?: Record<string, string>) => string;
  const label = (e: MemberActivityEvent): string => {
    if (e.type === 'ADMIN') {
      const [entity = '', verb = ''] = e.code.split('.');
      const what = loose(`events.entities.${ADMIN_ENTITIES.includes(entity) ? entity : 'other'}`);
      return ADMIN_VERBS.includes(verb) ? loose(`events.verbs.${verb}`, { what }) : t('events.admin.other');
    }
    if (e.type === 'ACTIVITY') return t(`events.activity.${e.code}` as never);
    return t(`events.${e.type.toLowerCase()}` as never);
  };

  return (
    <InfiniteTable
      key={days}
      initial={initial}
      endpoint={`/api/users/${userId}/activity-events?days=${days}`}
      minWidth={560}
      columns={[
        { key: 'when', header: t('cols.when'), render: (e) => <span className="whitespace-nowrap text-k-text-2">{whenLabel(e.at, locale, tw)}</span> },
        { key: 'event', header: t('cols.event'), render: (e) => <span className="font-medium text-k-text">{label(e)}</span> },
        { key: 'detail', header: t('cols.detail'), render: (e) => <span className="text-k-text-2">{e.clientName ? t('client', { name: e.clientName }) : '—'}</span> },
      ]}
    />
  );
}

/** Los accesos de un miembro, del más nuevo al más viejo, con scroll infinito. */
export function ConnectionsTable({
  userId,
  initial,
}: {
  userId: string;
  initial: CursorPage<MemberConnection>;
}) {
  const t = useTranslations('team.detail');
  const tw = useTranslations('team.lastAccess');
  const locale = useLocale();
  const region = (() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  })();

  const place = (c: MemberConnection): string => {
    const name = c.country ? (region?.of(c.country) ?? c.country) : null;
    return [c.city, name].filter(Boolean).join(', ') || '—';
  };

  return (
    <InfiniteTable
      initial={initial}
      endpoint={`/api/users/${userId}/connections`}
      columns={[
        { key: 'when', header: t('cols.when'), render: (c) => <span className="whitespace-nowrap text-k-text">{whenLabel(c.loginAt, locale, tw)}</span> },
        {
          key: 'device',
          header: t('cols.device'),
          render: (c) => (
            <span className="text-k-text">
              {[c.os, c.browser].filter(Boolean).join(' · ') || t('unknownDevice')}
              {c.deviceType === 'mobile' && <span className="ml-2 text-[12px] text-k-muted">{t('mobile')}</span>}
            </span>
          ),
        },
        { key: 'place', header: t('cols.place'), render: (c) => <span className="text-k-text-2">{place(c)}</span> },
        { key: 'ip', header: t('cols.ip'), render: (c) => <span className="font-mono text-[13px] text-k-text-2">{c.ip ?? '—'}</span> },
        {
          key: 'result',
          header: t('cols.result'),
          render: () => (
            <Badge dot tone="success">
              {t('success')}
            </Badge>
          ),
        },
      ]}
    />
  );
}
