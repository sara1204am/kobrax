/**
 * Sheet de "Registrar gestión" (Agenda S4). Un layout común cubre los 5 tipos: WhatsApp suma el
 * selector de plantilla + envío; el resto elige un desenlace y agrega una nota. "Posponer" corre la
 * hora sin ejecutar. Local a la agenda; sube a `ui.tsx` si S5/S6 lo piden.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AGENDA_OUTCOMES_BY_TYPE, AGENDA_POSTPONE_STEPS, AgendaItemStatus, AgendaItemType, CatalogType, renderTemplate, type AgendaOutcome, type AgendaPostponeStep } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from './theme';
import { Button, ErrorBanner } from './components';
import { AGENDA_OUTCOME_META, BottomSheet, SectionLabel } from './ui';
import { money } from './agenda-form';
import { completeItem, postponeItem, whatsappLink, type AgendaItemDetail, type AgendaListItem } from './agenda.service';
import { listCatalogCached, type CatalogOption } from './catalogs.service';
import { queueForLater } from './sync/sync.service';
import type { QueuedAction } from './sync/queue';

const POSTPONE_LABEL: Record<AgendaPostponeStep, string> = { 15: '+15 min', 30: '+30 min', 60: '+1 h' };

export function RegisterSheet({
  detail,
  visible,
  onClose,
  onUpdated,
  onOpenLink,
}: {
  detail: AgendaItemDetail;
  visible: boolean;
  onClose: () => void;
  /** El ítem quedó ejecutado o pospuesto: la pantalla refresca detalle + agenda. */
  onUpdated: (item: AgendaListItem) => void;
  /** Abrir un enlace externo (wa.me) — lo maneja la pantalla para reusar su haptic + manejo de error. */
  onOpenLink: (url: string) => void;
}) {
  const { item, client, credit } = detail;
  const outcomes = AGENDA_OUTCOMES_BY_TYPE[item.type];
  const [outcome, setOutcome] = useState<AgendaOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El sheet no se desmonta al cerrar (solo cambia `visible`): sin esto, una selección hecha y
  // descartada se re-enviaría en la próxima gestión. Se limpia al cerrarse.
  useEffect(() => {
    if (!visible) {
      setOutcome(null);
      setNotes('');
      setError(null);
    }
  }, [visible]);

  // Variables de las plantillas de WhatsApp. `{{saldo}}` sale del crédito que el detalle ya trajo.
  const vars = useMemo(
    () => ({ cliente: client.displayName, saldo: credit ? money(credit.outstandingBalance, credit.currency) : '' }),
    [client.displayName, credit],
  );

  /**
   * `accion` es la misma operación descrita para la cola. Se pasa junto con la llamada porque sin
   * red hay que poder guardarla, y una función ya invocada no se puede serializar.
   */
  const submit = useCallback(
    async (fn: () => ReturnType<typeof completeItem>, accion: QueuedAction) => {
      setBusy(true);
      setError(null);
      const res = await fn();
      setBusy(false);
      if (res.status === 'ok') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onUpdated(res.data);
        return;
      }
      if (res.status === 'offline') {
        // La gestión queda registrada en el teléfono y sube sola. Para el cobrador está hecha:
        // frenarlo por falta de señal es justo lo que el módulo existe para evitar.
        const guardada = await queueForLater(accion);
        if (guardada) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // El ítem local se marca como ejecutado aunque el server todavía no lo sepa: es lo que
          // el cobrador acaba de hacer, y el estado real llega cuando la cola drene.
          onUpdated({ ...item, status: AgendaItemStatus.EXECUTED });
          return;
        }
        setError('Sin conexión y no se pudo guardar en el teléfono. Reintentá.');
        return;
      }
      setError(
        res.status === 'unauthenticated'
          ? 'Tu sesión venció. Volvé a entrar.'
          : res.message ?? 'No se pudo registrar.',
      );
    },
    [item, onUpdated],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Registrar gestión">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }}>
        {item.type === AgendaItemType.WHATSAPP && (
          <WhatsAppBlock vars={vars} phone={detail.target?.phone} onSend={onOpenLink} />
        )}

        <SectionLabel>Resultado</SectionLabel>
        <View style={styles.chips}>
          {outcomes.map((o) => {
            const meta = AGENDA_OUTCOME_META[o];
            const active = outcome === o;
            return (
              <Pressable
                key={o}
                onPress={() => setOutcome(o)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && { backgroundColor: COLORS.highlight, borderColor: COLORS.purple }]}
              >
                <Text style={[styles.chipText, active && { color: COLORS.purple, fontWeight: '700' }]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>Nota (opcional)</SectionLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Detalle de la gestión…"
          placeholderTextColor={COLORS.muted}
          multiline
          style={styles.note}
        />

        <SectionLabel>Posponer para luego</SectionLabel>
        <View style={styles.chips}>
          {AGENDA_POSTPONE_STEPS.map((m) => (
            <Pressable
              key={m}
              onPress={() => submit(() => postponeItem(item.id, m), { kind: 'agenda.postpone', id: item.id, minutes: m })}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.chip, busy && { opacity: 0.5 }]}
            >
              <Text style={styles.chipText}>{POSTPONE_LABEL[m]}</Text>
            </Pressable>
          ))}
        </View>

        <ErrorBanner message={error} />
        <View style={{ marginTop: SPACING.md }}>
          <Button
            label="Registrar gestión"
            loading={busy}
            disabled={!outcome}
            onPress={() =>
              outcome &&
              submit(() => completeItem(item.id, outcome, notes.trim() || undefined), {
                kind: 'agenda.complete',
                id: item.id,
                outcome,
                notes: notes.trim() || undefined,
              })
            }
          />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

/** Selector de plantilla + contenido editable + envío por WhatsApp (variables ya resueltas). */
function WhatsAppBlock({
  vars,
  phone,
  onSend,
}: {
  vars: Record<string, string>;
  phone?: string;
  onSend: (url: string) => void;
}) {
  const [templates, setTemplates] = useState<CatalogOption[]>([]);
  const [body, setBody] = useState('');

  useEffect(() => {
    void (async () => {
      const res = await listCatalogCached(CatalogType.WHATSAPP_TEMPLATE);
      if (res.status === 'ok') setTemplates(res.data);
    })();
  }, []);

  const pick = useCallback((t: CatalogOption) => setBody(renderTemplate(t.metadata?.body ?? '', vars)), [vars]);

  return (
    <>
      <SectionLabel>Mensaje</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {templates.map((t) => (
          <Pressable key={t.id} onPress={() => pick(t)} accessibilityRole="button" style={styles.chip}>
            <Text style={styles.chipText}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="Escribí o elegí una plantilla…"
        placeholderTextColor={COLORS.muted}
        multiline
        style={styles.note}
      />
      <Button
        label="Enviar por WhatsApp"
        variant="ghost"
        disabled={!phone || !body.trim()}
        onPress={() => phone && onSend(whatsappLink(phone, body))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingVertical: SPACING.xs },
  chip: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.white,
  },
  chipText: { ...TYPE.secondary, color: COLORS.text, fontWeight: '600' },
  note: {
    ...TYPE.body,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.input,
    padding: SPACING.md,
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: COLORS.white,
  },
});
