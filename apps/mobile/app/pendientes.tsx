import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, StatusBadge } from '@/ui';
import { Button } from '@/components';
import { useNetStore } from '@/store/net';
import { getUserId } from '@/session';
import { whenLabel } from '@/notifications.service';
import { ACTION_LABEL, pendingActions, type QueuedAction } from '@/sync/queue';
import { drain } from '@/sync/sync.service';

interface Fila {
  id: number;
  action: QueuedAction;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

/**
 * Lo que el cobrador hizo y todavía no llegó al servidor (epic H1.5). Se entra tocando el banner.
 *
 * Existe por una razón de confianza: sin esta pantalla, "3 pendientes" es un número que el cobrador
 * no puede auditar. Acá ve **qué** es cada uno, de cuándo, y por qué no subió — y puede forzar el
 * reintento en vez de esperar al próximo ciclo.
 */
export default function PendientesScreen() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const online = useNetStore((s) => s.isConnected);

  const cargar = useCallback(async () => {
    const userId = await getUserId();
    setFilas(userId ? await pendingActions(userId) : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  const reintentar = useCallback(async () => {
    const userId = await getUserId();
    if (!userId) return;
    setSubiendo(true);
    setAviso(null);
    // `force` ignora el techo de intentos: el cobrador está mirando y decidió que se intente igual.
    const res = await drain(userId, { force: true });
    setSubiendo(false);
    await cargar();
    if (res.stopped === 'offline') setAviso('Sigue sin haber señal. Lo pendiente no se pierde.');
    else if (res.stopped === 'auth') setAviso('Tu sesión venció. Volvé a entrar y se sube solo.');
    else if (res.failed > 0) setAviso(`${res.sent} subieron; ${res.failed} siguen sin poder subir.`);
    else if (res.sent > 0) setAviso(`${res.sent} ${res.sent === 1 ? 'acción subió' : 'acciones subieron'}.`);
  }, [cargar]);

  return (
    <View style={styles.screen}>
      <Header title="Sin subir" onBack={() => router.back()} />

      {filas === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : filas.length === 0 ? (
        <EmptyState icon="✅" title="No hay nada pendiente" hint="Todo lo que registraste ya está en el servidor." />
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.lista}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => void cargar()} tintColor={COLORS.navy} />}
          >
            <Text style={styles.intro}>
              Esto ya quedó guardado en el teléfono y se sube solo cuando haya señal. No hace falta
              que lo vuelvas a cargar.
            </Text>
            {aviso && <Text style={styles.aviso}>{aviso}</Text>}

            {filas.map((f) => (
              <ListRow
                key={f.id}
                title={ACTION_LABEL[f.action.kind]}
                subtitle={
                  f.lastError
                    ? `${whenLabel(new Date(f.createdAt).toISOString())} · ${f.lastError}`
                    : whenLabel(new Date(f.createdAt).toISOString())
                }
                right={
                  f.attempts === 0 ? (
                    <StatusBadge label="En espera" tone="neutral" />
                  ) : (
                    <StatusBadge label={`${f.attempts} ${f.attempts === 1 ? 'intento' : 'intentos'}`} tone="warning" />
                  )
                }
              />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={online ? 'Reintentar ahora' : 'Sin conexión'}
              onPress={() => void reintentar()}
              loading={subiendo}
              disabled={!online || subiendo}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lista: { padding: SPACING.lg, gap: SPACING.md },
  intro: { ...TYPE.secondary },
  aviso: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
  footer: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
});
