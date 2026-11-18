import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
  canSubmitLegal,
  parseLegal,
  parseLegalInline,
  type LegalChoice,
  type SignupDocument,
} from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components';
import { LEGAL_SLUG, getLegalDocument, getSignupDocuments, type LegalDocument } from '@/legal.service';
import { COLORS, SPACING, TYPE } from '@/theme';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Carga las versiones vigentes de los documentos que se aceptan al crear el acceso. Sin ellas no se puede crear el acceso: la API exige
 * los ids de lo que la persona vio, y no hay alta sin aceptación. Si no hay conexión lo dice (crear la cuenta siempre pide internet).
 */
export function useSignupDocuments() {
  const [docs, setDocs] = useState<SignupDocument[] | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    const res = await getSignupDocuments();
    if (res.status === 'ok' && res.data.length > 0) {
      setDocs(res.data);
      setState('ready');
    } else {
      setDocs(null);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { docs, state, reload: load };
}

/** Texto de un documento: se arma con elementos de React Native a partir de DATOS (`parseLegal`), nunca interpretando HTML. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseLegalInline(text).map((p, i) => {
        if (p.kind === 'bold') return <Text key={i} style={{ fontWeight: '700' }}>{p.text}</Text>;
        if (p.kind === 'pending')
          return (
            <Text key={i} style={{ backgroundColor: COLORS.warningBg, color: COLORS.warningText }}>
              {p.text}
            </Text>
          );
        // Los enlaces internos se muestran como texto resaltado: no salen de la app (el documento enlazado se lee desde su casilla).
        if (p.kind === 'link') return <Text key={i} style={{ color: COLORS.purple, fontWeight: '500' }}>{p.text}</Text>;
        return p.text;
      })}
    </>
  );
}

function DocumentBody({ content }: { content: string }) {
  return (
    <View style={{ gap: SPACING.md }}>
      {parseLegal(content).map((b, i) => {
        if (b.kind === 'h')
          return (
            <Text key={i} accessibilityRole="header" style={{ ...(b.level === 1 ? TYPE.h2 : TYPE.h3), marginTop: b.level === 1 ? 0 : SPACING.sm }}>
              <Inline text={b.text} />
            </Text>
          );
        if (b.kind === 'p') return <Text key={i} style={TYPE.body}><Inline text={b.text} /></Text>;
        return (
          <View key={i} style={{ gap: SPACING.xs }}>
            {b.items.map((it, j) => (
              <Text key={j} style={{ ...TYPE.body, paddingLeft: SPACING.md }}>
                {b.kind === 'ol' ? `${j + 1}. ` : '•  '}
                <Inline text={it} />
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/**
 * El documento completo en UN modal encima del formulario: la **versión exacta** que se va a aceptar. Al aceptar, marca la casilla y se
 * vuelve al formulario con todo lo escrito intacto. Cerrar sin aceptar no marca nada.
 */
function DocumentModal({
  visible,
  onClose,
  slug,
  version,
  acknowledge,
  onAccept,
}: {
  visible: boolean;
  onClose: () => void;
  slug: string;
  version: string | undefined;
  acknowledge: boolean;
  onAccept: () => void;
}) {
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    if (!version) return;
    setState('loading');
    const res = await getLegalDocument(slug, version);
    if (res.status === 'ok') {
      setDoc(res.data);
      setState('ready');
    } else {
      setDoc(null);
      setState('error');
    }
  }, [slug, version]);

  // Se carga al abrir: el formulario no paga el texto jurídico si nadie lo abre.
  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, backgroundColor: COLORS.white }}>
        <View style={{ padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
          <Text accessibilityRole="header" style={TYPE.h2}>{doc?.title ?? ''}</Text>
          {doc && <Text style={TYPE.secondary}>Versión {doc.version}</Text>}
        </View>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}>
          {state === 'loading' && <Text style={TYPE.secondary}>Cargando el documento…</Text>}
          {state === 'error' && (
            <View style={{ gap: SPACING.sm }}>
              <ErrorBanner message="No pudimos cargar el documento. Revisá tu conexión e intentá de nuevo." />
              <Text onPress={() => void load()} accessibilityRole="button" style={TYPE.link}>Reintentar</Text>
            </View>
          )}
          {state === 'ready' && doc && <DocumentBody content={doc.content} />}
        </ScrollView>
        <View style={{ padding: SPACING.lg, gap: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Button
            label={acknowledge ? 'He leído y conozco la política' : 'He leído y acepto'}
            disabled={state !== 'ready'}
            onPress={() => {
              onAccept();
              onClose();
            }}
          />
          <Button label="Cerrar" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Una casilla accesible. El área de toque es la fila entera (cobrador con guantes), no solo el cuadro. */
function Check({ checked, onToggle, disabled, children }: { checked: boolean; onToggle: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md, minHeight: 44 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          marginTop: 1,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? COLORS.navy : COLORS.text2,
          backgroundColor: checked ? COLORS.navy : COLORS.white,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked && <Text style={{ color: COLORS.white, fontSize: 16, lineHeight: 18, fontWeight: '700' }}>✓</Text>}
      </View>
      <Text style={{ ...TYPE.body, flex: 1 }}>{children}</Text>
    </Pressable>
  );
}

/**
 * Las dos casillas obligatorias del registro y de la aceptación de invitación: **en línea, debajo de la contraseña**, desmarcadas, con el
 * mismo texto que la web. Aceptar los Términos (contractual) y reconocer la Política (constancia de que se le presentó la información; no
 * es un consentimiento general) son dos actos **separados**. Cada enlace abre el documento completo en un modal con la versión exacta.
 * No hay casilla de marketing: ese consentimiento opcional se ofrece desde Mi perfil y nunca condiciona el acceso.
 */
export function LegalConsents({
  docs,
  state,
  onReload,
  choice,
  onChange,
  disabled,
  stale,
}: {
  docs: SignupDocument[] | null;
  state: LoadState;
  onReload: () => void;
  choice: LegalChoice;
  onChange: (next: LegalChoice) => void;
  disabled?: boolean;
  /** Los documentos cambiaron mientras la persona llenaba el formulario: se avisa y se vuelve a pedir que los marque. */
  stale?: boolean;
}) {
  const [reading, setReading] = useState<'terms' | 'privacy' | null>(null);

  if (state === 'loading') return <Text style={TYPE.secondary}>Cargando los documentos…</Text>;
  if (state === 'error' || !docs) {
    return (
      <View style={{ gap: SPACING.sm }}>
        <ErrorBanner message="No pudimos cargar los Términos y la Política de Privacidad. Sin poder leerlos no podemos crear tu acceso." />
        <Text onPress={onReload} accessibilityRole="button" style={TYPE.link}>Reintentar</Text>
      </View>
    );
  }

  const version = (type: 'TERMS' | 'PRIVACY') => docs.find((d) => d.type === type)?.version;
  const link = (label: string, kind: 'terms' | 'privacy') => (
    <Text onPress={() => setReading(kind)} accessibilityRole="link" style={{ ...TYPE.body, color: COLORS.purple, fontWeight: '500' }}>
      {label}
    </Text>
  );

  return (
    <View style={{ gap: SPACING.md }}>
      {stale && <ErrorBanner message="Los documentos legales se actualizaron mientras completabas el formulario. Revisalos y volvé a marcar las casillas." />}

      <Check checked={choice.terms} onToggle={() => onChange({ ...choice, terms: !choice.terms })} disabled={disabled}>
        He leído y acepto los {link('Términos y Condiciones de Uso', 'terms')} de Kobrax.
      </Check>
      <Check checked={choice.privacy} onToggle={() => onChange({ ...choice, privacy: !choice.privacy })} disabled={disabled}>
        He leído la {link('Política de Privacidad', 'privacy')} y conozco cómo Kobrax recopila, utiliza, almacena y protege mis datos
        personales.
      </Check>

      <DocumentModal
        visible={reading === 'terms'}
        onClose={() => setReading(null)}
        slug={LEGAL_SLUG.TERMS}
        version={version('TERMS')}
        acknowledge={false}
        onAccept={() => onChange({ ...choice, terms: true })}
      />
      <DocumentModal
        visible={reading === 'privacy'}
        onClose={() => setReading(null)}
        slug={LEGAL_SLUG.PRIVACY}
        version={version('PRIVACY')}
        acknowledge
        onAccept={() => onChange({ ...choice, privacy: true })}
      />
    </View>
  );
}

export { canSubmitLegal };
