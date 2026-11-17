import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { SignupDocument } from '@/lib/legal';

/** Las versiones vigentes que devolvería `GET /api/legal/signup-documents` (ids fijos para afirmar sobre lo que viaja). */
export const SIGNUP_DOCS: SignupDocument[] = [
  { type: 'TERMS', action: 'ACCEPTED', versionId: 't-1', version: '1.0.0', title: 'Términos y Condiciones', contentSha256: 'a'.repeat(64) },
  { type: 'PRIVACY', action: 'ACKNOWLEDGED', versionId: 'p-1', version: '1.0.0', title: 'Política de Privacidad', contentSha256: 'b'.repeat(64) },
];

export const legalHandler = (docs: SignupDocument[] = SIGNUP_DOCS) =>
  http.get('*/api/legal/signup-documents', () => HttpResponse.json(docs));

export const termsBox = () => screen.findByRole('checkbox', { name: /términos y condiciones de uso/i });
export const privacyBox = () => screen.findByRole('checkbox', { name: /política de privacidad/i });

/** Marca las dos casillas obligatorias del pop-up (espera a que carguen los documentos). */
export async function acceptLegal() {
  await userEvent.click(await termsBox());
  await userEvent.click(await privacyBox());
}
