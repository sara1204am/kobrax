'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AssignableRole } from '@kobrax/shared';
import { Button } from '@/components/ui';
import type { OfficeOption } from '@/lib/offices';
import { usePermissions } from '@/components/permissions';
import { InviteDialog } from './invite-dialog';
import { TeamIcon } from './team-ui';

/**
 * Invitar a alguien al equipo. Sin permiso no se dibuja, y sin roles que ofrecer tampoco: el formulario no tendría
 * qué poner en el selector, y `roleId` es obligatorio para el servidor. El tope de asientos apaga el botón: es para no
 * ofrecer lo imposible; el freno de verdad lo pone el servidor.
 */
export function InviteButton({
  roles,
  offices,
  full,
}: {
  roles: AssignableRole[];
  /** Oficinas activas: el gerente regional (MANAGER) necesita una; su alcance es esa oficina y lo que cuelga de ella. */
  offices: OfficeOption[];
  /** Ya no quedan asientos en el plan. */
  full: boolean;
}) {
  const t = useTranslations('team.invite');
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  if (!can('user:invite') || roles.length === 0) return null;

  return (
    <>
      <span className="w-full sm:w-56">
        <Button onClick={() => setOpen(true)} disabled={full} title={full ? t('full') : undefined}>
          <span className="flex items-center gap-2">
            <TeamIcon name="invite" />
            {full ? t('full') : t('open')}
          </span>
        </Button>
      </span>
      <InviteDialog open={open} onClose={() => setOpen(false)} roles={roles} offices={offices} />
    </>
  );
}
