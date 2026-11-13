'use client';

import { useEffect, useState } from 'react';
import type { Member } from '@kobrax/shared';
import { Button, Field, Input, Select, ErrorBanner } from '@/components/ui';
import { MapPicker } from '@/components/map-picker';
import { SearchCombobox } from '@/components/user-combobox';
import { InviteDialog } from '../equipo/invite-dialog';
import { Modal } from '@/components/modal';
import { OfficeSelect } from '@/components/office-select';
import { Icon } from '@/components/panel-shell';
import { usePermissions } from '@/components/permissions';
import { sendJson } from '@/lib/client';
import { memberLabel } from '@/lib/branches';
import { activeOffices, officeOptions as officeOptionsOf, flattenTree, moveVerdict, willBranchRootWithPortfolio, type OfficeRow, type OfficeType } from '@/lib/offices';
import { buildOfficeTree } from '@kobrax/shared';
import { OfficeTeam } from './office-team';
import { useOfficeApi } from './use-office-api';

type Tab = 'data' | 'contact' | 'team';

interface Draft {
  name: string;
  code: string;
  typeId: string;
  parentId: string;
  managerUserId: string;
  city: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

const draftOf = (row: OfficeRow | null, parentId: string, typeId: string): Draft => ({
  name: row?.name ?? '',
  code: row?.code ?? '',
  typeId: row?.typeId ?? typeId,
  parentId: row?.parentId ?? parentId,
  managerUserId: row?.managerUserId ?? '',
  city: row?.city ?? '',
  address: row?.address ?? '',
  latitude: row?.latitude ?? null,
  longitude: row?.longitude ?? null,
});

/** Vaciar un dato opcional es quitarlo: viaja como `null` (un `''` chocaría con el `@Length` de la API). */
const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Crear o editar una oficina, en pestañas: **Datos** (nombre, código, tipo, oficina superior, responsable) · **Contacto y
 * ubicación** · **Equipo**. La pestaña con un campo inválido se marca con un punto, como en Gallium.
 *
 * Mover es otra llamada (`POST /branches/:id/move`): el servidor hace el chequeo de ciclo y de profundidad ahí.
 */
export function OfficeFormDialog({
  open,
  onClose,
  office,
  defaultParentId,
  rows,
  types,
  members,
  initialTab = 'data',
}: {
  open: boolean;
  onClose: () => void;
  /** La que se edita; `null` = alta. */
  office: OfficeRow | null;
  /** Oficina superior que viene preelegida en el alta («Añadir hija»). */
  defaultParentId: string;
  rows: OfficeRow[];
  types: OfficeType[];
  members: Member[];
  initialTab?: Tab;
}) {
  const { busy, error, setError, run, t } = useOfficeApi();
  const { can } = usePermissions();
  const activeTypes = types.filter((x) => x.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const [tab, setTab] = useState<Tab>(initialTab);
  const [inviting, setInviting] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(office, defaultParentId, activeTypes[0]?.id ?? ''));

  // Cada vez que se abre, se parte de los datos vigentes.
  useEffect(() => {
    if (open) {
      setDraft(draftOf(office, defaultParentId, activeTypes[0]?.id ?? ''));
      setTab(initialTab);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, office?.id, defaultParentId]);

  const editing = office !== null;
  const lockedParent = editing && office.isRoot;
  const parents = flattenTree(buildOfficeTree(activeOffices(rows))).map((r) => ({ id: r.id, name: r.fullName || r.name, depth: r.depth }));
  // Al editar no se puede elegir como superior a sí misma ni a su propio subárbol (ciclo).
  const blocked = new Set(
    editing ? parents.filter((p) => p.id === office.id || moveVerdict(rows, office.id, p.id) === 'INTO_OWN_SUBTREE').map((p) => p.id) : [],
  );
  const nameInvalid = draft.name.trim().length < 2;
  const typeInvalid = !draft.typeId;
  const parentInvalid = !lockedParent && !draft.parentId;
  const dataInvalid = nameInvalid || typeInvalid || parentInvalid;
  const branching = !editing && willBranchRootWithPortfolio(rows, draft.parentId);
  // Cualquier miembro vigente de la cuenta, con o sin oficina; también quien tiene la invitación pendiente.
  const eligibleManagers = members
    .filter((m) => m.isActive && m.userStatus !== 'INACTIVE' && m.userStatus !== 'SUSPENDED')
    .map((m) => ({ id: m.userId, label: memberLabel(m), detail: m.email }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const hasPoint = draft.latitude !== null && draft.longitude !== null;

  async function save() {
    const base = {
      name: draft.name.trim(),
      code: orNull(draft.code),
      city: orNull(draft.city),
      address: orNull(draft.address),
      typeId: draft.typeId,
      managerUserId: draft.managerUserId || null,
      // El punto viaja completo: las dos coordenadas, o `null` en las dos para quitarlo.
      latitude: hasPoint ? draft.latitude : null,
      longitude: hasPoint ? draft.longitude : null,
    };
    if (!editing) {
      // En el alta un dato vacío se omite: `null` no es un valor válido de creación.
      const body = Object.fromEntries(Object.entries({ ...base, parentId: draft.parentId }).filter(([, v]) => v !== null));
      await run(() => sendJson('/api/branches', body, 'POST'), t('form.created'), onClose);
      return;
    }
    const ok = await run(() => sendJson(`/api/branches/${office.id}`, base, 'PATCH'), draft.parentId === office.parentId || lockedParent ? t('form.saved') : undefined);
    if (!ok) return;
    if (!lockedParent && draft.parentId !== office.parentId) {
      await run(() => sendJson(`/api/branches/${office.id}/move`, { parentId: draft.parentId }, 'POST'), t('form.saved'), onClose);
      return;
    }
    onClose();
  }

  const tabs: { key: Tab; label: string; bad?: boolean; disabled?: boolean }[] = [
    { key: 'data', label: t('form.tabs.data'), bad: dataInvalid },
    { key: 'contact', label: t('form.tabs.contact') },
    { key: 'team', label: t('form.tabs.team'), disabled: !editing },
  ];

  return (
    <>
    <Modal
      wide
      open={open}
      onClose={onClose}
      locked={busy}
      title={editing ? t('form.editTitle', { name: office.name }) : t('form.addTitle')}
      actions={
        <>
          <span className="sm:w-36">
            <Button variant="ghost" onClick={onClose}>
              {tab === 'team' ? t('form.close') : t('form.cancel')}
            </Button>
          </span>
          {tab !== 'team' && (
            <span className="sm:w-44">
              <Button loading={busy} disabled={dataInvalid} onClick={() => void save()}>
                {t('form.save')}
              </Button>
            </span>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div role="tablist" aria-label={t('form.tabsLabel')} className="flex gap-1 overflow-x-auto border-b border-k-border">
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              id={`office-tab-${x.key}`}
              aria-selected={tab === x.key}
              aria-controls={`office-panel-${x.key}`}
              disabled={x.disabled}
              title={x.disabled ? t('form.teamAfterSave') : undefined}
              onClick={() => setTab(x.key)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[14px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                tab === x.key ? 'border-k-periwinkle text-k-periwinkle' : 'border-transparent text-k-text-2 hover:text-k-navy'
              }`}
            >
              {x.label}
              {x.bad && <span role="img" aria-label={t('form.tabHasErrors')} className="ml-1.5 inline-block h-2 w-2 rounded-full bg-k-danger align-middle" />}
            </button>
          ))}
        </div>

        {tab !== 'team' && <ErrorBanner message={error} />}

        {tab === 'data' && (
          <div role="tabpanel" id="office-panel-data" aria-labelledby="office-tab-data" className="space-y-4">
            <Field label={t('form.fields.name')}>
              <Input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('form.fields.code')} hint={t('form.fields.codeHint')}>
                <Input value={draft.code} maxLength={20} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
              </Field>
              <Field label={t('form.fields.type')}>
                <Select value={draft.typeId} onChange={(e) => setDraft({ ...draft, typeId: e.target.value })}>
                  {!draft.typeId && <option value="">{t('form.fields.pickType')}</option>}
                  {activeTypes.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                  {/* El tipo actual aunque ya esté desactivado: no se pierde en silencio. */}
                  {office?.typeId && !activeTypes.some((x) => x.id === office.typeId) && (
                    <option value={office.typeId}>{office.typeName ?? office.typeId}</option>
                  )}
                </Select>
              </Field>
            </div>
            {!lockedParent && (
              <Field label={t('form.fields.parent')}>
                <OfficeSelect options={parents} disabledIds={blocked} value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })} />
              </Field>
            )}
            {branching && (
              <p role="note" className="rounded-xl bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">
                {t('form.branchingWarning')}
              </p>
            )}
            <Field label={t('form.fields.manager')}>
              <SearchCombobox
                label={t('form.fields.manager')}
                options={eligibleManagers}
                value={draft.managerUserId}
                onChange={(id) => setDraft({ ...draft, managerUserId: id })}
                emptyLabel={t('form.fields.noManager')}
                placeholder={t('form.fields.managerSearch')}
                noResults={t('form.fields.managerNone')}
                footer={(close) =>
                  can('user:invite') ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        close();
                        setInviting(true);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="plus" className="h-4 w-4" />
                        {t('form.fields.addUser')}
                      </span>
                    </Button>
                  ) : null
                }
              />
            </Field>
          </div>
        )}

        {tab === 'contact' && (
          <div role="tabpanel" id="office-panel-contact" aria-labelledby="office-tab-contact" className="space-y-4">
            <Field label={t('form.fields.city')}>
              <Input value={draft.city} maxLength={80} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
            </Field>
            <Field label={t('form.fields.address')}>
              <Input value={draft.address} maxLength={240} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            </Field>
            <Field label={t('form.fields.location')} hint={t('form.fields.locationHint')}>
              <MapPicker
                label={t('form.fields.locationMap')}
                hint={t('form.fields.locationTap')}
                height={260}
                latitude={draft.latitude ?? undefined}
                longitude={draft.longitude ?? undefined}
                onChange={(c) => setDraft((d) => ({ ...d, latitude: Number(c.latitude.toFixed(6)), longitude: Number(c.longitude.toFixed(6)) }))}
              />
            </Field>
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={t('form.fields.latitude')}>
                <Input readOnly value={draft.latitude ?? ''} placeholder="—" />
              </Field>
              <Field label={t('form.fields.longitude')}>
                <Input readOnly value={draft.longitude ?? ''} placeholder="—" />
              </Field>
              <span className="sm:w-40">
                <Button type="button" variant="ghost" disabled={!hasPoint} onClick={() => setDraft({ ...draft, latitude: null, longitude: null })}>
                  {t('form.fields.clearPoint')}
                </Button>
              </span>
            </div>
          </div>
        )}

        {tab === 'team' && editing && (
          <div role="tabpanel" id="office-panel-team" aria-labelledby="office-tab-team">
            <OfficeTeam office={office} rows={rows} members={members} editable />
          </div>
        )}
      </div>
    </Modal>
    <InviteDialog
      open={inviting}
      onClose={() => setInviting(false)}
      offices={officeOptionsOf(rows)}
      defaultOfficeId={office?.id ?? draft.parentId}
      onInvited={(m) => setDraft((d) => ({ ...d, managerUserId: m.userId }))}
    />
    </>
  );
}
