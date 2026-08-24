import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MyProfile } from '@kobrax/shared';
import { ToastProvider } from '@/components/toast';
import { ProfileForm } from './profile-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const PROFILE: MyProfile = {
  userId: 'u1',
  email: 'ana@kobrax.demo',
  firstName: 'Ana',
  lastName: 'Pérez',
  phone: null,
  photoUrl: null,
  paymentQrUrl: '/api/account/upload/qr.png',
};

const renderForm = (profile: MyProfile) =>
  render(
    <ToastProvider>
      <ProfileForm profile={profile} />
    </ToastProvider>,
  );

describe('ProfileForm — ver el QR en grande', () => {
  it('abre el visor con el QR guardado y lo cierra', async () => {
    renderForm(PROFILE);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver en grande' }));
    const dialog = screen.getByRole('dialog', { name: 'Escanea para pagar' });
    expect(dialog.querySelector('img')).toHaveAttribute('src', PROFILE.paymentQrUrl);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sin QR guardado no ofrece verlo', () => {
    renderForm({ ...PROFILE, paymentQrUrl: null });
    expect(screen.queryByRole('button', { name: 'Ver en grande' })).not.toBeInTheDocument();
  });

  it('quitar el QR esconde el visor hasta guardar', async () => {
    renderForm(PROFILE);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(screen.queryByRole('button', { name: 'Ver en grande' })).not.toBeInTheDocument();
  });
});
