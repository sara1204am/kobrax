import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createTranslator } from 'next-intl';
import type { AccountRequestInfo, Member } from '@kobrax/shared';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { ClosureRequest } from './closure-request';
import { OwnershipTransfer } from './ownership-transfer';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

function member(over: Partial<Member> & { userId: string }): Member {
  return {
    email: `${over.userId}@kobrax.demo`,
    firstName: over.userId.toUpperCase(),
    lastName: 'Admin',
    phone: null,
    photoUrl: null,
    roleId: 'r',
    roleName: 'ACCOUNT_ADMIN',
    isOwner: false,
    isActive: true,
    userStatus: 'ACTIVE',
    ...over,
  };
}

const MEMBERS: Member[] = [
  member({ userId: 'me', isOwner: true }),
  member({ userId: 'luis' }),
  member({ userId: 'sup', roleName: 'SUPERVISOR' }),
  member({ userId: 'off', isActive: false }),
  member({ userId: 'new', userStatus: 'PENDING' }),
];

beforeEach(() => refresh.mockClear());

function renderOwnership(isOwner = true, members = MEMBERS) {
  return render(
    <ToastProvider>
      <OwnershipTransfer members={members} selfId="me" isOwner={isOwner} />
    </ToastProvider>,
  );
}

describe('OwnershipTransfer', () => {
  it('🔴 sólo ofrece a otros ADMINISTRADORES ACTIVOS: ni uno mismo, ni supervisores, ni inactivos, ni invitados sin aceptar', () => {
    renderOwnership();
    const opciones = Array.from((screen.getByLabelText('Nuevo dueño') as HTMLSelectElement).options).map((o) => o.value);
    expect(opciones).toEqual(['', 'luis']);
  });

  it('no se puede enviar sin elegir a alguien y escribir la contraseña', async () => {
    renderOwnership();
    expect(screen.getByRole('button', { name: 'Transferir propiedad' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Nuevo dueño'), 'luis');
    expect(screen.getByRole('button', { name: 'Transferir propiedad' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Tu contraseña'), 'x');
    expect(screen.getByRole('button', { name: 'Transferir propiedad' })).toBeEnabled();
  });

  it('pide una confirmación explícita con el nombre antes de mandar nada', async () => {
    let llamadas = 0;
    server.use(
      http.post('*/api/account/transfer-ownership', () => {
        llamadas += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderOwnership();
    await userEvent.selectOptions(screen.getByLabelText('Nuevo dueño'), 'luis');
    await userEvent.type(screen.getByLabelText('Tu contraseña'), 'Secreto-123!');
    await userEvent.click(screen.getByRole('button', { name: 'Transferir propiedad' }));

    expect(screen.getByText(/Vas a pasarle la propiedad de la cuenta a LUIS Admin/)).toBeInTheDocument();
    expect(llamadas).toBe(0);
  });

  it('confirmado, manda el destinatario, la contraseña y el código, y limpia los campos', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/account/transfer-ownership', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderOwnership();
    await userEvent.selectOptions(screen.getByLabelText('Nuevo dueño'), 'luis');
    await userEvent.type(screen.getByLabelText('Tu contraseña'), 'Secreto-123!');
    await userEvent.type(screen.getByLabelText(/Código de verificación/), ' 123456 ');
    await userEvent.click(screen.getByRole('button', { name: 'Transferir propiedad' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, transferir' }));

    expect(await screen.findByText('Propiedad transferida')).toBeInTheDocument();
    expect(enviado).toEqual({ userId: 'luis', password: 'Secreto-123!', code: '123456' });
    expect(screen.getByLabelText('Tu contraseña')).toHaveValue('');
    expect(refresh).toHaveBeenCalled();
  });

  it('si la contraseña es incorrecta muestra el error en el formulario y conserva lo escrito para corregir', async () => {
    server.use(
      http.post('*/api/account/transfer-ownership', () =>
        HttpResponse.json({ error: { code: 'OWNER_PASSWORD_INVALID', message: 'La contraseña no es correcta' } }, { status: 400 }),
      ),
    );
    renderOwnership();
    await userEvent.selectOptions(screen.getByLabelText('Nuevo dueño'), 'luis');
    await userEvent.type(screen.getByLabelText('Tu contraseña'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Transferir propiedad' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, transferir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña no es correcta');
    expect(screen.getByLabelText('Nuevo dueño')).toHaveValue('luis');
  });

  it('quien no es el dueño ve el motivo y ningún formulario', () => {
    renderOwnership(false);
    expect(screen.getByText(/Solo el dueño actual/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Tu contraseña')).not.toBeInTheDocument();
  });

  it('sin otro administrador activo lo dice', () => {
    renderOwnership(true, [member({ userId: 'me', isOwner: true })]);
    expect(screen.getByText(/No hay otro administrador activo/)).toBeInTheDocument();
  });
});

const closure = (over: Partial<AccountRequestInfo> = {}): AccountRequestInfo => ({
  id: 'r1',
  type: 'CLOSURE',
  status: 'PENDING',
  plan: null,
  note: null,
  handledNote: null,
  createdAt: '2026-10-21T12:00:00.000Z',
  handledAt: null,
  ...over,
});

function renderClosure(requests: AccountRequestInfo[] = []) {
  return render(
    <ToastProvider>
      <ClosureRequest businessName="Cobranzas Pérez" requests={requests} timezone="America/La_Paz" />
    </ToastProvider>,
  );
}

describe('ClosureRequest', () => {
  it('🔴 no deja enviar hasta escribir el nombre del negocio (sin importar mayúsculas)', async () => {
    renderClosure();
    await userEvent.click(screen.getByRole('button', { name: 'Pedir la baja' }));
    const enviar = screen.getAllByRole('button', { name: 'Pedir la baja' }).at(-1)!;
    expect(enviar).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Escribe «Cobranzas Pérez»/), 'otro');
    expect(enviar).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Escribe «Cobranzas Pérez»/));
    await userEvent.type(screen.getByLabelText(/Escribe «Cobranzas Pérez»/), 'cobranzas PÉREZ');
    expect(enviar).toBeEnabled();
  });

  it('manda el tipo, el nombre confirmado y la nota; no borra nada por sí mismo', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/account/requests', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(closure());
      }),
    );
    renderClosure();
    await userEvent.click(screen.getByRole('button', { name: 'Pedir la baja' }));
    await userEvent.type(screen.getByLabelText(/Escribe «Cobranzas Pérez»/), 'Cobranzas Pérez');
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Cerramos la oficina');
    await userEvent.click(screen.getAllByRole('button', { name: 'Pedir la baja' }).at(-1)!);

    expect(await screen.findByText('Pedido enviado')).toBeInTheDocument();
    expect(enviado).toEqual({ type: 'CLOSURE', confirmName: 'Cobranzas Pérez', note: 'Cerramos la oficina' });
  });

  it('con un pedido de baja pendiente lo dice y no ofrece pedir otro', () => {
    renderClosure([closure()]);
    expect(screen.getByRole('status')).toHaveTextContent(/Ya pediste la baja/);
    expect(screen.queryByRole('button', { name: 'Pedir la baja' })).not.toBeInTheDocument();
  });

  it('un pedido de cambio de plan pendiente no cuenta como baja', () => {
    renderClosure([closure({ type: 'PLAN_CHANGE', plan: 'BUSINESS' })]);
    expect(screen.getByRole('button', { name: 'Pedir la baja' })).toBeInTheDocument();
  });
});

describe('textos de Avanzado', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s: los de retención se formatean con números reales', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'account.advanced.retention' });
    expect(t('older', { older: 12, total: 1500 })).toMatch(/12/);
    expect(t('older', { older: 12, total: 1500 })).not.toContain('account.advanced');
    expect(t('months', { n: 1 })).not.toContain('account.advanced');
    expect(t('months', { n: 24 })).toContain('24');
  });
});
