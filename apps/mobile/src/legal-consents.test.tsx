// El servicio es la frontera de red: se reemplaza para controlar qué documentos "llegan".
jest.mock('./legal.service', () => ({
  LEGAL_SLUG: { TERMS: 'terms', PRIVACY: 'privacy' },
  getSignupDocuments: jest.fn(),
  getLegalDocument: jest.fn(),
}));
// components.tsx arrastra el estado de red y los íconos nativos: acá solo importan Button y ErrorBanner.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { EMPTY_CHOICE, canSubmitLegal, type LegalChoice, type SignupDocument } from '@kobrax/shared';
import { useState } from 'react';
import { LegalConsents } from './legal-consents';
import { getLegalDocument } from './legal.service';

const DOCS: SignupDocument[] = [
  { type: 'TERMS', action: 'ACCEPTED', versionId: 't-1', version: '1.0.0', title: 'Términos', contentSha256: 'a'.repeat(64) },
  { type: 'PRIVACY', action: 'ACKNOWLEDGED', versionId: 'p-1', version: '1.0.0', title: 'Política', contentSha256: 'b'.repeat(64) },
];

const getDoc = getLegalDocument as jest.Mock;

/** Un contenedor con estado real: las casillas se marcan de verdad y se puede preguntar si ya se puede enviar. */
function Harness({ docs = DOCS, state = 'ready', stale = false, onChoice }: { docs?: SignupDocument[] | null; state?: 'loading' | 'ready' | 'error'; stale?: boolean; onChoice?: (c: LegalChoice) => void }) {
  const [choice, setChoice] = useState<LegalChoice>(EMPTY_CHOICE);
  onChoice?.(choice);
  return <LegalConsents docs={docs} state={state} onReload={jest.fn()} choice={choice} onChange={setChoice} stale={stale} />;
}

// Con el modal abierto el formulario queda oculto a accesibilidad (`accessibilityViewIsModal`) y RNTL no calcula el nombre de la casilla:
// se identifican por orden, que es estable (Términos primero, Política después), incluyendo lo oculto.
const boxes = () => screen.getAllByRole('checkbox', { includeHiddenElements: true });
const terms = () => boxes()[0]!;
const privacy = () => boxes()[1]!;

beforeEach(() => getDoc.mockReset());

describe('LegalConsents (móvil)', () => {
  it('🔴 las dos casillas aparecen desmarcadas con el texto aprobado', () => {
    render(<Harness />);
    expect(terms().props.accessibilityState.checked).toBe(false);
    expect(privacy().props.accessibilityState.checked).toBe(false);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText(/He leído y acepto los/)).toBeTruthy();
    expect(screen.getByText(/y conozco cómo Kobrax recopila, utiliza, almacena y protege mis datos/)).toBeTruthy();
  });

  it('🔴 son actos separados: solo se puede enviar con LAS DOS marcadas', () => {
    let current: LegalChoice = EMPTY_CHOICE;
    render(<Harness onChoice={(c) => (current = c)} />);
    expect(canSubmitLegal(DOCS, current)).toBe(false);
    fireEvent.press(terms());
    expect(canSubmitLegal(DOCS, current)).toBe(false);
    fireEvent.press(privacy());
    expect(canSubmitLegal(DOCS, current)).toBe(true);
    fireEvent.press(terms()); // se puede volver a desmarcar
    expect(canSubmitLegal(DOCS, current)).toBe(false);
  });

  it('el enlace abre el documento en un modal con la versión EXACTA y abrirlo NO marca la casilla', async () => {
    getDoc.mockResolvedValue({ status: 'ok', data: { id: 'x', type: 'TERMS', version: '1.0.0', title: 'Términos y Condiciones de Uso', content: '# Título\n\nTexto del documento.', contentSha256: 'a'.repeat(64), effectiveAt: '2026-11-16T12:00:00.000Z' } });
    render(<Harness />);
    fireEvent.press(screen.getByText('Términos y Condiciones de Uso'));
    expect(await screen.findByText('Texto del documento.')).toBeTruthy();
    expect(getDoc).toHaveBeenCalledWith('terms', '1.0.0');
    expect(terms().props.accessibilityState.checked).toBe(false);
  });

  it('🔴 «He leído y acepto» dentro del documento marca la casilla de los Términos y la Política sigue sin marcar', async () => {
    getDoc.mockResolvedValue({ status: 'ok', data: { id: 'x', type: 'TERMS', version: '1.0.0', title: 'T', content: 'Texto.', contentSha256: 'a'.repeat(64), effectiveAt: '2026-11-16T12:00:00.000Z' } });
    render(<Harness />);
    fireEvent.press(screen.getByText('Términos y Condiciones de Uso'));
    await screen.findByText('Texto.');
    fireEvent.press(screen.getByText('He leído y acepto'));
    await waitFor(() => expect(terms().props.accessibilityState.checked).toBe(true));
    expect(privacy().props.accessibilityState.checked).toBe(false);
  });

  it('el documento de la Política dice «He leído y conozco la política» y marca solo su casilla', async () => {
    getDoc.mockResolvedValue({ status: 'ok', data: { id: 'x', type: 'PRIVACY', version: '1.0.0', title: 'P', content: 'Texto.', contentSha256: 'b'.repeat(64), effectiveAt: '2026-11-16T12:00:00.000Z' } });
    render(<Harness />);
    fireEvent.press(screen.getByText('Política de Privacidad'));
    await screen.findByText('Texto.');
    fireEvent.press(screen.getByText('He leído y conozco la política'));
    await waitFor(() => expect(privacy().props.accessibilityState.checked).toBe(true));
    expect(terms().props.accessibilityState.checked).toBe(false);
  });

  it('si el documento no se puede cargar lo dice y NO permite aceptar', async () => {
    getDoc.mockResolvedValue({ status: 'offline' });
    render(<Harness />);
    fireEvent.press(screen.getByText('Términos y Condiciones de Uso'));
    expect(await screen.findByText(/no pudimos cargar el documento/i)).toBeTruthy();
    fireEvent.press(screen.getByText('He leído y acepto'));
    expect(terms().props.accessibilityState.checked).toBe(false);
  });

  it('🔴 un texto con HTML o scripts se muestra como texto y no se interpreta', async () => {
    getDoc.mockResolvedValue({ status: 'ok', data: { id: 'x', type: 'TERMS', version: '1.0.0', title: 'T', content: 'Hola <script>alert(1)</script> fin', contentSha256: 'a'.repeat(64), effectiveAt: '2026-11-16T12:00:00.000Z' } });
    render(<Harness />);
    fireEvent.press(screen.getByText('Términos y Condiciones de Uso'));
    expect(await screen.findByText(/Hola <script>alert\(1\)<\/script> fin/)).toBeTruthy();
  });

  it('si los documentos no cargan, lo dice y ofrece reintentar (sin documentos no hay alta)', () => {
    render(<Harness docs={null} state="error" />);
    expect(screen.getByText(/no pudimos cargar los términos/i)).toBeTruthy();
    expect(screen.getByText('Reintentar')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('mientras cargan no hay casillas, solo el aviso de carga', () => {
    render(<Harness docs={null} state="loading" />);
    expect(screen.getByText(/cargando los documentos/i)).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('si la versión cambió mientras llenaba el formulario, avisa', () => {
    render(<Harness stale />);
    expect(screen.getByText(/se actualizaron mientras completabas/i)).toBeTruthy();
  });
});
