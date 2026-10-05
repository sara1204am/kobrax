import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MfaReminder } from './mfa-reminder';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('MfaReminder (W-LOG-51)', () => {
  it('avisa que la verificación en dos pasos está pendiente y lleva a Seguridad', () => {
    render(<MfaReminder />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('Protege tu cuenta')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/security');
  });
});
