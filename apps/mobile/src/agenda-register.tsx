/**
 * Sheet de "Registrar gestión" (Agenda S4). Un layout común cubre los 5 tipos: WhatsApp suma el
 * selector de plantilla + envío; el resto elige un desenlace y agrega una nota. "Posponer" corre la
 * hora sin ejecutar. Local a la agenda; sube a `ui.tsx` si S5/S6 lo piden.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AGENDA_OUTCOMES_BY_TYPE, AGENDA_POSTPONE_STEPS, AgendaItemStatus, AgendaItemType, CatalogType, ScheduleTimeMode, renderTemplate, type AgendaOutcome, type AgendaPostponeStep } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from './theme';
import { Button, ErrorBanner } from './components';
import { AGENDA_OUTCOME_META, BottomSheet, SectionLabel } from './ui';
import { money } from './agenda-form';
import { getAccount } from './account.service';
import { completeItem, postponeItem, postponeTarget, whatsappLink, type AgendaItemDetail, type AgendaListItem } from './agenda.service';
import { syncAgendaReminders } from './agenda-notifications';
import { todayISO } from './agenda-form';
import { listCatalogCached, type CatalogOption } from './catalogs.service';
import { queueForLater } from './sync/sync.service';
import { patchAgendaItemLocal } from './sync/agenda-optimistic';
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

  // `{{negocio}}` es el nombre de la cuenta: sale de la copia local, así que anda sin señal.
  const [negocio, setNegocio] = useState('');
  useEffect(() => {
    void getAccount().then((r) => {
      if (r.status === 'ok') setNegocio(r.data.businessName);
    });
  }, []);

  // Variables de las plantillas de WhatsApp. `{{saldo}}` sale del crédito que el detalle ya trajo.
  const vars = useMemo(
    () => ({
      cliente: client.displayName,
      saldo: credit ? money(credit.outstandingBalance, credit.currency) : '',
      negocio,
    }),
    [client.displayName, credit, negocio],
  );

  /**
   * `accion` es la misma operación descrita para la cola. Se pasa junto con la llamada porque sin
   * red hay que poder guardarla, y una función ya invocada no se puede serializar.
   */
  const submit = useCallback(
    async (
      fn: () => ReturnType<typeof completeItem>,
      accion: QueuedAction,
      /** Cómo queda el ítem en pantalla mientras la cola no lo sube (por omisión: ejecutado). */
      local: Partial<AgendaListItem> = { status: AgendaItemStatus.EXECUTED },
    ) => {
      setBusy(true);
      setError(null);
      const res = await fn();
      setBusy(false);
      if (res.status === 'ok') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Pospuesta: el aviso programado quedó a la hora vieja. Programar el mismo id lo reemplaza.
        if (local.scheduledTime) void syncAgendaReminders([res.data], { complete: false }).catch(() => undefined);
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
          // Y en las listas y contadores del teléfono: sin esto, al volver a la Agenda seguía pendiente y se podía registrar otra vez.
          await patchAgendaItemLocal(item, local);
          // El parche cancela el aviso viejo; el de la hora nueva se programa ya (sin esperar a la próxima hidratación).
          if (local.scheduledTime) void syncAgendaReminders([{ ...item, ...local }], { complete: false }).catch(() => undefined);
          onUpdated({ ...item, ...local });
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
              onPress={() => {
                // La hora de destino se calcula ACÁ, al tocar: la misma viaja en el intento y en la cola, así
                // que repetir el envío deja la gestión en esa hora y no la corre otro tanto.
                // D-8: una de HOY que ya venció se pospone desde AHORA (sumar sobre su hora vieja la dejaba en el pasado).
                const now = new Date();
                const isToday = String(item.scheduledDate).slice(0, 10) === todayISO(now);
                const toTime = postponeTarget(item, m, isToday ? { nowMinutes: now.getHours() * 60 + now.getMinutes() } : {});
                if (!toTime) {
                  // Posponer no cambia de día: no hay hora válida. Se dice, en vez de mandar un pedido que se rechaza
                  // (o, sin señal, de «posponer» sin efecto).
                  setError('No se puede posponer más allá de las 23:59. Usa «Reagendar» para elegir otro día.');
                  return;
                }
                return submit(
                  () => postponeItem(item.id, m, toTime),
                  { kind: 'agenda.postpone', id: item.id, minutes: m, toTime },
                  // Pospuesta sigue pendiente: sólo cambia la hora, y deja de ser «por franja» (no se marca como ejecutada).
                  { timeMode: ScheduleTimeMode.FIXED, scheduledTime: toTime, timeSlot: undefined },
                );
              }}
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
