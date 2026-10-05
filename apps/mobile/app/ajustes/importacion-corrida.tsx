import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { ImportRunItem, ImportRunItemAction, ImportRunSummary } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING } from '@/theme';
import { EmptyState, Header, OfflineIndicator, SectionLabel } from '@/ui';
import { CountTiles } from '@/import-views';
import {
  getRun,
  lastRunWhen,
  listRunItems,
  moreLabel,
  LIST_LIMIT,
  previewLine,
  rejectText,
  RUN_ACTION_LABEL,
  runActions,
} from '@/import.service';

/**
 * Detalle de una corrida (sólo lectura): los contadores y, por cada tipo, qué le pasó a cada registro.
 * Sin descarga del archivo. Cada lista se pide al abrirla y queda guardada para verla sin señal.
 */
export default function ImportacionCorridaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<ImportRunSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');

  const load = useCallback(async () => {
    const res = await getRun(id);
    if (res.status === 'ok') {
      setRun(res.data);
      setState('ok');
    } else setState(res.status === 'offline' ? 'offline' : 'error');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const c = run?.counts;
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <OfflineIndicator />
      <Header title="Importación" onBack={() => router.back()} />
      {state === 'loading' && <ActivityIndicator color={COLORS.navy} style={{ marginTop: SPACING.xl }} />}
      {state === 'offline' && <EmptyState icon="📴" title="Sin conexión" hint="Esta importación no está guardada en el teléfono." />}
      {state === 'error' && <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintenta en un momento." />}
      {run && c && (
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Text style={styles.title}>{`${lastRunWhen(run.at)}${run.createdBy ? ` · ${run.createdBy.name}` : ''}`}</Text>
          <Text style={styles.muted}>
            {[run.file?.name, run.template, run.scope, run.reportDate ? `Corte ${run.reportDate.split('-').reverse().join('/')}` : null, run.advisorCode ? `Asesor ${run.advisorCode}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <CountTiles counts={{ created: c.created, updated: c.updated, setCurrent: c.setCurrent, absent: c.absent, reappeared: c.reappeared, ignored: c.ignored }} />
          {c.rejected > 0 && <Text style={styles.danger}>{`${c.rejected} registro${c.rejected === 1 ? '' : 's'} no se importaron`}</Text>}
          {c.needsReview > 0 && <Text style={styles.muted}>{`${c.needsReview} cliente${c.needsReview === 1 ? '' : 's'} nuevo${c.needsReview === 1 ? '' : 's'} para revisar vínculo en el panel.`}</Text>}
          {!run.itemsComplete && <Text style={styles.muted}>Es de antes del historial: no guarda el detalle de «al día» ni de rechazados.</Text>}
          {runActions(c).map((a) => (
            <ItemsBlock key={a} runId={run.id} action={a} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** Una lista de registros de un tipo, plegada hasta que se abre. */
function ItemsBlock({ runId, action }: { runId: string; action: ImportRunItemAction }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ImportRunItem[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'offline' | 'error'>('idle');
  const [showAll, setShowAll] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || items) return;
    setState('loading');
    const res = await listRunItems(runId, action);
    if (res.status === 'ok') {
      setItems(res.data);
      setState('ok');
    } else setState(res.status === 'offline' ? 'offline' : 'error');
  }

  const shown = items ? (showAll ? items : items.slice(0, LIST_LIMIT)) : [];
  const more = items ? moreLabel(items.length, shown.length) : null;
  return (
    <View>
      <Pressable onPress={() => void toggle()} accessibilityRole="button">
        <SectionLabel>{`${open ? '▾' : '▸'} ${RUN_ACTION_LABEL[action]}`}</SectionLabel>
      </Pressable>
      {open && state === 'loading' && <ActivityIndicator color={COLORS.navy} />}
      {open && state === 'offline' && <Text style={styles.muted}>Sin conexión: esta lista no está guardada en el teléfono.</Text>}
      {open && state === 'error' && <Text style={styles.danger}>No se pudo cargar.</Text>}
      {open && state === 'ok' && items?.length === 0 && <Text style={styles.muted}>Sin registros.</Text>}
      {open &&
        shown.map((it) => (
          <View key={it.id} style={styles.item}>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {it.clientName ?? it.externalId ?? `Registro ${it.rowNumber ?? ''}`}
            </Text>
            <Text style={styles.muted} numberOfLines={2}>
              {action === 'REJECTED'
                ? [it.rowNumber ? `Registro ${it.rowNumber}` : null, it.externalId, it.reason ? rejectText(it.reason) : null].filter(Boolean).join(' · ')
                : previewLine(it.externalId ?? null, it.before, it.after)}
            </Text>
          </View>
        ))}
      {open && more && (
        <Pressable onPress={() => setShowAll(true)} hitSlop={8}>
          <Text style={styles.more}>{more}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600', color: COLORS.navy },
  muted: { fontSize: 13, color: COLORS.text2 },
  danger: { fontSize: 13, color: COLORS.danger },
  item: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, padding: SPACING.md, marginTop: SPACING.xs, gap: 2 },
  itemTitle: { fontSize: 15, fontWeight: '500', color: COLORS.text },
  more: { fontSize: 13, color: COLORS.slate, fontWeight: '600', paddingVertical: SPACING.xs },
});
