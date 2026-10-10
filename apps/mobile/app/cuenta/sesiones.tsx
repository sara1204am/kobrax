import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING } from '@/theme';
import { EmptyState, Header, ListRow, OfflineIndicator, StatusBadge } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { listSessions, revokeOtherSessions, revokeSession, sessionTitle, type SessionInfo } from '@/sessions.service';

/** «Hace un rato» sin librería: da el día y la hora tal cual los guardó el servidor. */
function when(iso?: string): string | undefined {
  if (!iso) return undefined;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/** Sesiones activas (U3): ver dónde está abierta la cuenta y cerrar las que no se reconocen. Siempre en línea. */
export default function SesionesScreen() {
  const [state, setState] = useState<'loading' | 'offline' | 'error' | 'ok'>('loading');
  const [rows, setRows] = useState<SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await listSessions();
    if (res.status === 'ok') {
      setRows(res.data);
      setState('ok');
    } else if (res.status === 'offline') setState('offline');
    else if (res.status === 'unauthenticated') router.replace('/(auth)/login');
    else setState('error');
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const close = (s: SessionInfo) => {
    Alert.alert('Cerrar sesión', `Se cerrará la sesión de ${sessionTitle(s)}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError(null);
          const res = await revokeSession(s.id);
          setBusy(false);
          if (res.status === 'error') return setError(res.message);
          if (res.status === 'offline') return setError('Sin conexión. Probá de nuevo con señal.');
          await load();
        },
      },
    ]);
  };

  const closeOthers = async () => {
    setBusy(true);
    setError(null);
    const res = await revokeOtherSessions();
    setBusy(false);
    if (res.status === 'error') return setError(res.message);
    if (res.status === 'offline') return setError('Sin conexión. Probá de nuevo con señal.');
    await load();
  };

  const others = rows.filter((r) => !r.isCurrent);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Sesiones activas" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />
        {state === 'loading' && <ActivityIndicator color={COLORS.periwinkle} />}
        {state === 'offline' && <EmptyState title="Sin conexión" hint="Las sesiones se consultan en línea." />}
        {state === 'error' && <EmptyState title="No se pudieron cargar" hint="Probá de nuevo en un momento." />}
        {state === 'ok' &&
          rows.map((s) => (
            <ListRow
              key={s.id}
              title={sessionTitle(s)}
              subtitle={[s.accountName, [s.city, s.country].filter(Boolean).join(', '), when(s.lastSeenAt ?? s.loginAt)]
                .filter(Boolean)
                .join(' · ')}
              icon={s.deviceType === 'mobile' ? 'phone-portrait-outline' : 'desktop-outline'}
              right={s.isCurrent ? <StatusBadge label="Esta sesión" tone="info" /> : undefined}
              onPress={s.isCurrent || busy ? undefined : () => close(s)}
            />
          ))}
        {state === 'ok' && others.length > 0 && (
          <Button label="Cerrar las demás sesiones" variant="ghost" onPress={() => void closeOthers()} loading={busy} disabled={busy} />
        )}
      </ScrollView>
    </View>
  );
}
