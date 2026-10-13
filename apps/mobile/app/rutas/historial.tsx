import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { VisitOutcome, type VisitItem } from '@kobrax/shared';
import { COLORS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, OfflineIndicator, StatusBadge, type BadgeTone } from '@/ui';
import { formatLongDate } from '@/agenda-form';
import { listStopVisits } from '@/field.service';

const OUTCOME: Record<VisitOutcome, { label: string; tone: BadgeTone }> = {
  [VisitOutcome.PAID]: { label: 'Cobrado', tone: 'success' },
  [VisitOutcome.PARTIAL_PAYMENT]: { label: 'Pago parcial', tone: 'success' },
  [VisitOutcome.PROMISE_TO_PAY]: { label: 'Promesa de pago', tone: 'warning' },
  [VisitOutcome.CONTACTED]: { label: 'Contactado', tone: 'info' },
  [VisitOutcome.NO_CONTACT]: { label: 'Sin contacto', tone: 'neutral' },
  [VisitOutcome.NOT_FOUND]: { label: 'No estaba', tone: 'neutral' },
  [VisitOutcome.REFUSAL]: { label: 'Se negó', tone: 'danger' },
  [VisitOutcome.RESCHEDULED]: { label: 'Reagendada', tone: 'neutral' },
  [VisitOutcome.WRONG_ADDRESS]: { label: 'Dirección incorrecta', tone: 'danger' },
  [VisitOutcome.SPECIAL]: { label: 'Gestión especial', tone: 'info' },
};

/**
 * Historial de una parada (R7): qué se gestionó ahí y cuándo. Solo lectura y solo en línea (es historial de personas: no se
 * baja en masa al teléfono). Una visita no se edita; si se registró mal, se corrige con una visita nueva desde la parada.
 */
export default function HistorialParadaScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const [rows, setRows] = useState<VisitItem[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');

  const load = useCallback(async () => {
    const res = await listStopVisits(stopId);
    if (res.status === 'ok') {
      setRows(res.data);
      setState('ok');
    } else if (res.status === 'offline') setState('offline');
    else if (res.status === 'unauthenticated') router.replace('/(auth)/login');
    else setState('error');
  }, [stopId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Historial de la parada" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        {state === 'loading' && <ActivityIndicator color={COLORS.periwinkle} />}
        {state === 'offline' && <EmptyState title="Sin conexión" hint="El historial se consulta en línea." />}
        {state === 'error' && <EmptyState title="No se pudo cargar" hint="Probá de nuevo en un momento." />}
        {state === 'ok' && rows && rows.length === 0 && <EmptyState title="Todavía no hay gestiones en esta parada" />}
        {state === 'ok' &&
          rows?.map((v) => {
            const meta = OUTCOME[v.outcome] ?? { label: String(v.outcome), tone: 'neutral' as const };
            return (
              <View key={v.id} style={{ gap: SPACING.xs }}>
                <ListRow
                  title={meta.label}
                  subtitle={`${formatLongDate(v.capturedAt.slice(0, 10))} · ${v.capturedAt.slice(11, 16)}`}
                  right={<StatusBadge label={v.source === 'WEB' ? 'Desde el panel' : 'En campo'} tone="neutral" />}
                />
                {v.notes ? <Text style={TYPE.secondary}>{v.notes}</Text> : null}
                {v.correctsVisitId ? <Text style={TYPE.caption}>Corrige una gestión anterior.</Text> : null}
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
}
