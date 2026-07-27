import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING } from '@/theme';
import { BottomSheet, Chips, EmptyState, Header, ListRow, OfflineIndicator, SectionLabel, StatTile } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { useNetStore } from '@/store/net';
import {
  ABSENT_RULE_HINT,
  ABSENT_RULE_LABEL,
  importService,
  lastRunWhen,
  PROFILE_HINT,
  PROFILE_LABEL,
  SCOPE_HINT,
  SCOPE_LABEL,
  SCOPE_REF_TITLE,
  scopeRefName,
  setupStep,
  soleAssignee,
  type AbsentRule,
  type ConfigScreen,
  type ImportConfig,
  type ImportConfigPatch,
  type ProfileKind,
  type ScopeKind,
} from '@/import.service';

type Sheet = 'profile' | 'preset' | 'absent' | 'scope-ref' | null;

/**
 * Ajustes › Importación (FIELD-RULES §6).
 *
 * Se define una vez y el import diario no vuelve a preguntar. La pantalla ordena las decisiones
 * en el orden en que dependen entre sí (§6.9): sin formato no se sabe qué columnas hay para
 * emparejar, y cambiarlo después resetea el emparejado.
 */
export default function ImportacionScreen() {
  const [screen, setScreen] = useState<ConfigScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const online = useNetStore((s) => s.isConnected);

  const load = useCallback(async () => {
    const res = await importService.getConfig();
    if (res.status === 'ok') setScreen(res.data);
    else if (res.status === 'offline') setError('Sin conexión. La configuración se lee y se guarda en línea.');
    else if (res.status === 'error') setError(res.message);
    setLoading(false);
  }, []);

  // Al volver de "Emparejar columnas" hay que releer: pudo cambiar el emparejado.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => setError(null), [sheet]);

  /**
   * Volver al estado de fábrica: el asistente arranca de cero. Pide confirmación porque tira el
   * emparejado, que es lo más caro de rehacer. No toca la cartera ya importada — sólo la config.
   */
  function confirmReset() {
    Alert.alert(
      'Reiniciar la configuración',
      'Se borra el formato, el emparejado de columnas y el alcance. La cartera ya importada no se toca.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Reiniciar', style: 'destructive', onPress: () => void save({ reset: true }) },
      ],
    );
  }

  /** Guarda al toque. Si el backend rechaza por invariante, el control vuelve al valor previo. */
  async function save(patch: ImportConfigPatch) {
    if (!screen) return;
    const prev = screen.config;
    // Optimista, salvo al reiniciar: ahí el valor nuevo lo arma el backend, no el patch.
    if (!patch.reset) setScreen({ ...screen, config: { ...prev, ...patch } as ImportConfig });
    const res = await importService.patch(patch);
    if (res.status === 'ok') {
      setScreen((s) => (s ? { ...s, config: res.data.config } : s));
      setError(null);
    } else {
      setScreen((s) => (s ? { ...s, config: prev } : s)); // revertir: nada de estado que miente
      setError(
        res.status === 'offline'
          ? 'Sin conexión: no se guardó.'
          : res.status === 'error'
            ? res.message
            : 'Tu sesión venció',
      );
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Importación" onBack={() => router.back()} />
      </View>
    );
  }
  if (!screen) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Importación" onBack={() => router.back()} />
        <EmptyState icon="⚠️" title="No se pudo cargar" hint={error ?? undefined} />
      </View>
    );
  }

  // Defaults a [] a propósito: una API más vieja que la app (o una respuesta parcial) no debe
  // tumbar la pantalla entera con "Cannot read property 'find' of undefined". Sin selector se
  // puede vivir; con pantalla azul no.
  const { config, lastRun, members = [], branches = [] } = screen;
  const step = setupStep(config);
  const isFile = config.source === 'file';
  const mapped = Object.values(config.fields).filter((r) => r.from && r.enabled !== false).length;
  const daysRule = config.fields.daysPastDue;
  const refTitle = SCOPE_REF_TITLE[config.scope.kind];
  const refName = scopeRefName(config.scope, members, branches);
  // §2.4: con toda la cartera de la empresa y un solo miembro, no hay reparto que hacer.
  const sole = config.scope.kind === 'account' ? soleAssignee(members) : null;

  // Bloqueo del asistente: una fila se apaga sólo si su paso todavía no llegó, y siempre dice
  // POR QUÉ. Un control gris sin motivo es un bug para el usuario.
  const blocked = (needs: 'scope' | 'profile' | 'fields'): string | undefined => {
    if (!step) return undefined;
    if (needs === 'profile' && step === 'scope') return 'Elegí el alcance primero';
    if (needs === 'fields' && (step === 'scope' || step === 'profile')) return 'Elegí la forma del archivo primero';
    return undefined;
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <OfflineIndicator />
      <Header title="Importación" onBack={() => router.back()} />
      {/* §6.8: sin conexión la pantalla no se usa. Se apaga entera en vez de enhebrar un `disabled`
          por cada control: cubre también los que se agreguen después. El `‹` queda vivo porque está
          fuera. Guardar reglas offline abriría la puerta a dos dispositivos reconciliando la misma
          cartera con reglas distintas. */}
      <ScrollView
        style={{ opacity: online ? 1 : 0.5 }}
        pointerEvents={online ? 'auto' : 'none'}
        contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}
      >
        {error && <ErrorBanner message={error} />}

        <SectionLabel>ÚLTIMA IMPORTACIÓN</SectionLabel>
        {lastRun ? (
          <>
            <Text style={styles.muted}>
              {lastRunWhen(lastRun.at)}
              {lastRun.template ? ` · ${lastRun.template}` : ''}
              {lastRun.scope ? ` · ${lastRun.scope}` : ''}
            </Text>
            <View style={styles.tiles}>
              <StatTile label="Agregados" value={String(lastRun.created)} />
              <StatTile label="Actualizados" value={String(lastRun.updated)} />
              <StatTile label="Al día" value={String(lastRun.setCurrent)} />
            </View>
            {lastRun.errors > 0 && (
              <Text style={styles.danger}>
                {lastRun.errors} fila{lastRun.errors === 1 ? '' : 's'} con problemas
              </Text>
            )}
            {/* §6.3: el detalle de la corrida son estos mismos contadores en grande — la corrida
                guarda conteos, no el registro por fila. Sin endpoint nuevo: se le pasa el `lastRun`
                que esta pantalla ya tiene. */}
            <ListRow
              title="Ver detalle"
              onPress={() =>
                router.push({
                  pathname: '/import/resultado',
                  params: {
                    mode: 'read',
                    created: String(lastRun.created),
                    updated: String(lastRun.updated),
                    setCurrent: String(lastRun.setCurrent),
                    invalid: String(lastRun.errors),
                    when: lastRunWhen(lastRun.at),
                    template: lastRun.template ?? '',
                    scope: lastRun.scope ?? '',
                  },
                })
              }
            />
            {/* §6.2: el histórico se mantiene aunque el tenant pase a carga manual; se aclara por qué
                no se va a actualizar más, en vez de dejar un dato viejo sin contexto. */}
            {!isFile && <Text style={styles.muted}>Origen cambiado a manual.</Text>}
          </>
        ) : (
          <Text style={styles.muted}>Todavía no importaste ningún archivo.</Text>
        )}

        <SectionLabel>ORIGEN DE DATOS</SectionLabel>
        <Chips
          options={[
            { value: 'manual', label: 'Manual' },
            { value: 'file', label: 'Archivo' },
          ]}
          value={config.source}
          onChange={(v) => void save({ source: v })}
        />

        {!isFile ? (
          // Sin archivo, ninguna de las otras preguntas existe. La pantalla se colapsa (§6.2);
          // lo ya configurado NO se borra: si vuelve a "Archivo", lo encuentra como lo dejó.
          <>
            <Text style={styles.muted}>Los créditos se cargan uno por uno. No se lee ningún archivo.</Text>
            <ListRow title="Agregar crédito a mano" onPress={() => router.push('/prestamo/nuevo')} />
          </>
        ) : (
          <>
            <SectionLabel>ALCANCE DEL ARCHIVO</SectionLabel>
            <Chips
              options={(['official', 'branch', 'account'] as ScopeKind[]).map((v) => ({ value: v, label: SCOPE_LABEL[v] }))}
              value={config.scope.kind}
              onChange={(kind) => void save({ scope: { kind, ref: kind === 'account' ? null : config.scope.ref } })}
            />
            <Text style={styles.muted}>{SCOPE_HINT[config.scope.kind]}</Text>

            {/* Sin esta fila, elegir Oficial o Agencia dejaba `scope.ref` en null y el asistente
                se trababa en el paso 2 para siempre: pedía un alcance que ningún control podía
                completar (FIELD-RULES §6.4). */}
            {refTitle && (
              <ListRow
                title={refTitle}
                subtitle={refName ?? `Elegí cuál · sin esto el import no arranca`}
                onPress={() => setSheet('scope-ref')}
              />
            )}
            {sole && <Text style={styles.muted}>Se asigna a {sole.name}.</Text>}

            <ListRow
              title="Forma del archivo"
              subtitle={blocked('profile') ?? PROFILE_LABEL[config.profile.kind]}
              onPress={blocked('profile') ? undefined : () => setSheet('profile')}
            />
            <ListRow
              title="¿El archivo trae el cobrador?"
              right={
                <Switch
                  value={config.carriesAssignee}
                  onValueChange={(v) => void save({ carriesAssignee: v })}
                  accessibilityLabel="El archivo trae el cobrador asignado"
                />
              }
            />

            <ListRow
              title="Reglas"
              subtitle={`Ausentes: ${ABSENT_RULE_LABEL[config.absentRule].toLowerCase()}`}
              onPress={() => setSheet('absent')}
            />
            <ListRow
              title="Emparejar columnas"
              subtitle={
                blocked('fields') ??
                (mapped === 0
                  ? 'Todavía no emparejaste ningún campo'
                  : `${mapped} campo${mapped === 1 ? '' : 's'} emparejado${mapped === 1 ? '' : 's'}`)
              }
              right={daysRule?.from && !daysRule.calibrated ? <Text style={styles.warn}>⚠</Text> : undefined}
              onPress={blocked('fields') ? undefined : () => router.push('/ajustes/importacion-columnas')}
            />
            <ListRow title="Llave de match" subtitle="N° de crédito" />

            <SectionLabel>AL INICIAR SESIÓN</SectionLabel>
            <ListRow
              title="Preguntar al iniciar sesión"
              subtitle={config.askOnLogin ? undefined : 'Entrás por Más › Importar datos.'}
              right={
                <Switch
                  value={config.askOnLogin}
                  onValueChange={(v) => void save({ askOnLogin: v })}
                  accessibilityLabel="Preguntar al iniciar sesión"
                />
              }
            />

            {/* §7·P1: es el `dryRun` que ya existe. Sin esto, la única forma de saber si emparejaste
                bien es importar de verdad y ver la cartera rota. */}
            <Button
              variant="ghost"
              label="Probar con un archivo"
              onPress={() => router.push({ pathname: '/import/archivo', params: { test: '1' } })}
            />
          </>
        )}

        {/* Última salida cuando la configuración quedó enredada: empezar de nuevo. Va al final y
            fuera del `isFile` — se llega acá justamente cuando lo de arriba no sirve. */}
        <Button variant="ghost" label="Reiniciar la configuración" onPress={confirmReset} />
      </ScrollView>

      <OptionSheet
        visible={sheet === 'profile'}
        title="Forma del archivo"
        onClose={() => setSheet(null)}
        options={(['rows', 'pdf-rows', 'pdf-blocks'] as ProfileKind[]).map((v) => ({
          value: v,
          label: PROFILE_LABEL[v],
          hint: PROFILE_HINT[v],
        }))}
        value={config.profile.kind}
        onPick={(kind) => {
          setSheet(null);
          // Cambiar la forma resetea el emparejado (invariante 4): las etiquetas de un formato
          // no significan nada en el otro. Lo hace el backend; acá sólo se avisa con el subtítulo.
          void save({ profile: { ...config.profile, kind } });
        }}
      />

      <OptionSheet
        visible={sheet === 'scope-ref'}
        title={refTitle ?? ''}
        hint={
          config.scope.kind === 'official'
            ? 'El reconcile toca sólo los créditos de esta persona.'
            : 'El reconcile toca sólo los créditos de esta agencia.'
        }
        empty={
          config.scope.kind === 'official'
            ? 'No hay usuarios activos en la cuenta.'
            : 'No hay agencias cargadas. Elegí "Empresa (todos)" mientras tanto.'
        }
        onClose={() => setSheet(null)}
        options={
          config.scope.kind === 'official'
            ? members.map((m) => ({ value: m.id, label: m.name, hint: m.role }))
            : branches.map((b) => ({ value: b.id, label: b.name }))
        }
        value={config.scope.ref ?? ''}
        onPick={(ref) => {
          setSheet(null);
          void save({ scope: { kind: config.scope.kind, ref } });
        }}
      />

      <OptionSheet
        visible={sheet === 'absent'}
        title="Reglas de importación"
        hint="Los créditos que YA tenés y que NO vienen en el archivo, ¿qué hacen?"
        footer="Ningún crédito se elimina al importar. Los cargados a mano y los de fuera del alcance no se tocan nunca."
        onClose={() => setSheet(null)}
        options={(['set-current', 'no-touch', 'ask'] as AbsentRule[]).map((v) => ({
          value: v,
          label: ABSENT_RULE_LABEL[v],
          hint: ABSENT_RULE_HINT[v],
        }))}
        value={config.absentRule}
        onPick={(absentRule) => {
          setSheet(null);
          void save({ absentRule });
        }}
      />
    </View>
  );
}

/** Hoja de opciones con radio. Se repite en 3 lugares de esta pantalla; no sale de acá. */
function OptionSheet<T extends string>({
  visible,
  title,
  hint,
  footer,
  empty,
  options,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  hint?: string;
  footer?: string;
  /** Qué decir cuando no hay ninguna opción — una hoja vacía y muda parece un bug. */
  empty?: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onPick: (v: T) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {hint && <Text style={styles.sheetHint}>{hint}</Text>}
      {options.length === 0 && empty && <Text style={styles.optionHint}>{empty}</Text>}
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onPick(o.value)}
          style={styles.option}
          accessibilityRole="radio"
          accessibilityState={{ selected: o.value === value }}
        >
          <Text style={styles.optionMark}>{o.value === value ? '●' : '○'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>{o.label}</Text>
            {o.hint && <Text style={styles.optionHint}>{o.hint}</Text>}
          </View>
        </Pressable>
      ))}
      {footer && <Text style={styles.sheetFooter}>{footer}</Text>}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: SPACING.sm },
  muted: { fontSize: 13, color: COLORS.text2 },
  danger: { fontSize: 13, color: COLORS.danger, fontWeight: '600' },
  warn: { fontSize: 16, color: COLORS.warning },
  sheetHint: { fontSize: 14, color: COLORS.text2, marginBottom: SPACING.sm },
  sheetFooter: { fontSize: 12, color: COLORS.muted, marginTop: SPACING.sm },
  option: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.sm, alignItems: 'flex-start' },
  optionMark: { fontSize: 16, color: COLORS.navy, width: 20 },
  optionLabel: { fontSize: 15, color: COLORS.text, fontWeight: '500' },
  optionHint: { fontSize: 13, color: COLORS.text2, marginTop: 2 },
});
