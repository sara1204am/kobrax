import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { ImportRunSummary } from '@kobrax/shared';
import { COLORS, SPACING } from '@/theme';
import { EmptyState, Header, ListRow, OfflineIndicator } from '@/ui';
import { ErrorBanner } from '@/components';
import { lastRunWhen, listRuns } from '@/import.service';

/**
 * Historial de importaciones (sólo lectura): las corridas de cartera, la más reciente primero. Con
 * respaldo local: sin señal se ve lo de la última vez. No hay descarga del archivo (eso es del panel).
 */
export default function ImportacionHistorialScreen() {
  const [runs, setRuns] = useState<ImportRunSummary[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [localAt, setLocalAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await listRuns();
    if (res.status === 'ok') {
      setRuns(res.data);
      setLocalAt(res.localAt ?? null);
      setState('ok');
    } else setState(res.status === 'offline' ? 'offline' : 'error');
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <OfflineIndicator />
      <Header title="Historial de importaciones" onBack={() => router.back()} />
      {state === 'loading' && <ActivityIndicator color={COLORS.navy} style={{ marginTop: SPACING.xl }} />}
      {state === 'offline' && <EmptyState icon="📴" title="Sin conexión" hint="El historial aparecerá cuando vuelva la red." />}
      {state === 'error' && <ErrorBanner message="No se pudo cargar el historial." />}
      {state === 'ok' && runs && (
        <ScrollView
          contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.sm }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
              tintColor={COLORS.navy}
            />
          }
        >
          {localAt != null && <Text style={styles.muted}>Sin conexión: datos guardados en el teléfono.</Text>}
          {runs.length === 0 && <EmptyState icon="📄" title="Sin importaciones" hint="Todavía no se importó ningún archivo." />}
          {runs.map((r) => (
            <ListRow
              key={r.id}
              title={`${lastRunWhen(r.at)}${r.createdBy ? ` · ${r.createdBy.name}` : ''}`}
              subtitle={[
                r.file?.name,
                r.reportDate ? `Corte ${r.reportDate.split('-').reverse().join('/')}` : null,
                `${r.counts.created} nuevos · ${r.counts.updated} actualizados${r.counts.rejected ? ` · ${r.counts.rejected} rechazados` : ''}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => router.push({ pathname: '/ajustes/importacion-corrida', params: { id: r.id } })}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ muted: { fontSize: 13, color: COLORS.text2 } });
