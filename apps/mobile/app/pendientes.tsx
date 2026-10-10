import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, StatusBadge } from '@/ui';
import { Button } from '@/components';
import { useNetStore } from '@/store/net';
import { getUserId } from '@/session';
import { whenLabel } from '@/notifications.service';
import { actionLabel, discardPending, pendingActions, type PendingAction } from '@/sync/queue';
import { REJECTED_ATTEMPTS } from '@/db';
import { drain, refreshPendingCount } from '@/sync/sync.service';
import { queuePhotosUsage } from '@/queue-photos';
import { PENDING_PHOTOS_MAX_BYTES } from '@kobrax/shared';

interface Fila {
  id: number;
  action: PendingAction;
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
  /** Lo que ocupan las fotos que esperan señal (D-9): para que el cobrador sepa cuánto lugar queda. */
  const [fotos, setFotos] = useState<{ count: number; bytes: number } | null>(null);

  const cargar = useCallback(async () => {
    const userId = await getUserId();
    setFilas(userId ? await pendingActions(userId) : []);
    setFotos(await queuePhotosUsage());
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
    else if (res.stopped === 'upgrade') setAviso('Hay que actualizar la app. Lo pendiente está a salvo y sale solo al actualizar.');
    else if (res.failed > 0) setAviso(`${res.sent} subieron; ${res.failed} siguen sin poder subir.`);
    else if (res.sent > 0) setAviso(`${res.sent} ${res.sent === 1 ? 'acción subió' : 'acciones subieron'}.`);
  }, [cargar]);

  /**
   * Descartar lo que el servidor rechazó o que esta versión no sabe enviar. **Pide confirmación**: es lo único que
   * borra trabajo del cobrador sin que haya subido, así que no puede pasar por un toque sin querer.
   */
  const descartar = useCallback(
    (f: Fila) => {
      Alert.alert(
        'Descartar este pendiente',
        `«${actionLabel(f.action.kind)}» no se va a subir y se borra del teléfono. No se puede deshacer.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Descartar',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await discardPending(f.id, f.action);
                const userId = await getUserId();
                if (userId) await refreshPendingCount(userId);
                await cargar();
              })();
            },
          },
        ],
      );
    },
    [cargar],
  );

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
            {fotos && fotos.count > 0 && (
              <Text style={TYPE.secondary}>
                {`${fotos.count} ${fotos.count === 1 ? 'foto espera' : 'fotos esperan'} señal · ${(fotos.bytes / 1048576).toFixed(1)} MB de ${Math.round(PENDING_PHOTOS_MAX_BYTES / 1048576)} MB`}
              </Text>
            )}

            {filas.map((f) => {
              const noSoportado = f.action.kind === 'unsupported';
              const rechazado = f.attempts >= REJECTED_ATTEMPTS;
              // Lo no soportado muestra su motivo aunque todavía no haya intentado enviarse.
              const detalle = f.lastError ?? (f.action.kind === 'unsupported' ? `No soportado: ${f.action.reason}` : null);
              return (
                <View key={f.id} style={{ gap: SPACING.xs }}>
                  <ListRow
                    title={actionLabel(f.action.kind === 'unsupported' ? f.action.rawKind : f.action.kind)}
                    subtitle={
                      detalle
                        ? `${whenLabel(new Date(f.createdAt).toISOString())} · ${detalle}`
                        : whenLabel(new Date(f.createdAt).toISOString())
                    }
                    right={
                      noSoportado ? (
                        <StatusBadge label="No soportado" tone="danger" />
                      ) : f.attempts === 0 ? (
                        <StatusBadge label="En espera" tone="neutral" />
                      ) : rechazado ? (
                        <StatusBadge label="Rechazado" tone="danger" />
                      ) : (
                        <StatusBadge label={`${f.attempts} ${f.attempts === 1 ? 'intento' : 'intentos'}`} tone="warning" />
                      )
                    }
                  />
                  {(rechazado || noSoportado) && <Button label="Descartar" variant="ghost" onPress={() => descartar(f)} />}
                </View>
              );
            })}
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
