'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Member } from '@kobrax/shared';
import { Section, Badge } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import { canAddFirstOffice, activeOffices, type OfficeRow, type OfficeType } from '@/lib/offices';
import { OfficeFormDialog } from './office-form';

/**
 * La cuenta con UNA sola oficina (RULES C2, ADR-0004): nada de jerarquía. Se ven los datos de su oficina y, si tiene
 * `office:write` y el plan deja otra, el aviso para crear la primera agencia. Ni árbol, ni buscador, ni selectores.
 */
export function SingleOffice({
  rows,
  types,
  members,
  plan,
}: {
  rows: OfficeRow[];
  types: OfficeType[];
  members: Member[];
  plan: { used: number; limit: number | null };
}) {
  const t = useTranslations('account.offices');
  const { can } = usePermissions();
  const writable = can('office:write');
  const office = activeOffices(rows)[0] ?? rows[0];
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null);
  const mayAdd = canAddFirstOffice({ canWrite: writable, used: plan.used, limit: plan.limit });
  const planBlocks = writable && !mayAdd;
  const trash = rows.length - activeOffices(rows).length;

  if (!office) return null;
  const facts: [string, string | null][] = [
    [t('single.name'), office.name],
    [t('form.fields.code'), office.code],
    [t('form.fields.type'), office.typeName],
    [t('form.fields.city'), office.city],
    [t('form.fields.address'), office.address],
    [t('form.fields.manager'), office.managerName ?? null],
  ];

  return (
    <Section
      title={t('single.title')}
      inner="space-y-5 p-4 sm:p-6"
      action={
        writable ? (
          <button type="button" onClick={() => setDialog('edit')} className="text-[13px] font-medium text-k-purple hover:underline">
            {t('menu.edit')}
          </button>
        ) : undefined
      }
    >
      <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
            <dd className="mt-1 break-words text-[15px] text-k-text">{value || <span className="text-k-muted">—</span>}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('single.team')}</dt>
          <dd className="mt-1 text-[15px] text-k-text">{t('preview.members', { n: office.members })}</dd>
        </div>
      </dl>

      {mayAdd && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
          <span>{t('single.firstAgencyHint')}</span>
          <button type="button" onClick={() => setDialog('add')} className="font-semibold text-k-purple hover:underline">
            {t('single.firstAgency')}
          </button>
        </div>
      )}
      {planBlocks && (
        <p role="note" className="rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
          {t('single.planBlocks', { limit: plan.limit ?? 0 })}{' '}
          <Link href="/cuenta/plan" className="font-semibold underline">
            {t('seePlan')}
          </Link>
        </p>
      )}
      {writable && trash > 0 && (
        <Link href="/cuenta/oficinas/papelera" className="inline-block text-[13px] font-medium text-k-purple hover:underline">
          {t('trash.link', { n: trash })}
        </Link>
      )}
      {!writable && <Badge>{t('single.readOnly')}</Badge>}

      {dialog && (
        <OfficeFormDialog
          open
          onClose={() => setDialog(null)}
          office={dialog === 'edit' ? office : null}
          defaultParentId={office.id}
          rows={rows}
          types={types}
          members={members}
        />
      )}
    </Section>
  );
}
