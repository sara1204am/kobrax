import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS, SPACING } from '@/theme';
import { BottomSheet, EmptyState, Header, ListRow, SectionLabel } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import {
  applyFieldState,
  FIELD_STATE_HINT,
  FIELD_STATE_LABEL,
  fieldState,
  importService,
  NAME_ORDER_LABEL,
  previewName,
  type ConfigScreen,
  type FieldRule,
  type FieldState,
  type NameOrder,
} from '@/import.service';

/**
 * Ajustes › Importación › Emparejar columnas (FIELD-RULES §6.5).
 *
 * Funciona igual en las dos formas de archivo: lo que cambia es de dónde sale la lista de
 * orígenes (encabezados en Excel/CSV, etiquetas del bloque en PDF), no la mecánica. **Todo campo
 * es editable en todo formato** — nada viene fijo "porque está en el parser" (C12).
 */
export default function ColumnasScreen() {
  const [screen, setScreen] = useState<ConfigScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // campo cuyo estado se edita
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState(false);

  const load = useCallback(async () => {
    const res = await importService.getConfig();
    if (res.status === 'ok') setScreen(res.data);
    else setError(res.status === 'offline' ? 'Sin conexión.' : 'No se pudo cargar la configuración');
  }, []);
  useEffect(() => void load(), [load]);

  async function save(fields: Record<string, FieldRule>, extra: Record<string, unknown> = {}) {
    if (!screen) return;
    const prev = screen.config;
    const res = await importService.patch({ fields, ...extra });
    if (res.status === 'ok') {
      setScreen({ ...screen, config: res.data.config });
      setError(null);
    } else {
      setScreen({ ...screen, config: prev });
      setError(
        res.status === 'offline'
          ? 'Sin conexión: no se guardó.'
          : res.status === 'error'
            ? res.message
            : 'Tu sesión venció',
      );
    }
  }

  if (!screen) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Emparejar columnas" onBack={() => router.back()} />
        {error && <ErrorBanner message={error} />}
      </View>
    );
  }

  const { config, catalog } = screen;
  const entries = Object.entries(config.fields).filter(([, r]) => r.from || r.enabled !== false);
  const sinEmparejar = Object.keys(catalog).filter((f) => !config.fields[f]?.from);
  const keyFrom = config.fields.code?.from;
  const daysRule = config.fields.daysPastDue;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Emparejar columnas" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        {error && <ErrorBanner message={error} />}

        <View style={styles.keyBox}>
          <Text style={styles.keyTitle}>Llave: N° de crédito {keyFrom ? `← "${keyFrom}"` : ''}</Text>
          <Text style={styles.hint}>
            El campo no se puede cambiar (identifica a cada crédito), pero sí de qué etiqueta se lee.
          </Text>
        </View>

        {entries.length === 0 ? (
          // Sin archivo de muestra no hay etiquetas que listar: es la pieza que hace configurable
          // un formato que nunca vimos (§6.5). El picker llega con `expo-document-picker`.
          <EmptyState
            icon="📄"
            title="Todavía no hay nada emparejado"
            hint="Elegí un preset en la pantalla anterior, o subí un archivo de muestra para ver qué columnas trae."
          />
        ) : (
          <>
            <SectionLabel>CAMPOS EMPAREJADOS</SectionLabel>
            {entries.map(([field, rule]) => {
              const def = catalog[field];
              const state = fieldState(rule);
              const isName = field === 'clientName';
              const sinConfirmar = field === 'daysPastDue' && rule.from && !rule.calibrated;
              return (
                <View key={field}>
                  <ListRow
                    title={def?.label ?? field}
                    subtitle={`${rule.from ? `"${rule.from}"` : 'sin emparejar'} · ${FIELD_STATE_LABEL[state]}`}
                    right={sinConfirmar ? <Text style={styles.warn}>⚠</Text> : undefined}
                    onPress={def?.locked && field === 'code' ? undefined : () => setEditing(field)}
                  />
                  {isName && (
                    <Pressable onPress={() => setNaming(true)} style={styles.subAction}>
                      <Text style={styles.subActionText}>{NAME_ORDER_LABEL[config.nameOrder]} ›</Text>
                    </Pressable>
                  )}
                  {sinConfirmar && <Text style={styles.warnText}>Sin confirmar — revisá los valores</Text>}
                </View>
              );
            })}
          </>
        )}

        {sinEmparejar.length > 0 && (
          <Button variant="ghost" label="+ Agregar campo del archivo" onPress={() => setAdding(true)} />
        )}
      </ScrollView>

      {/* Estado del campo: un solo control de tres estados, no dos toggles (§6.5). */}
      <BottomSheet visible={!!editing} onClose={() => setEditing(null)} title={catalog[editing ?? '']?.label}>
        {(['required', 'optional', 'off'] as FieldState[]).map((s) => (
          <Pressable
            key={s}
            style={styles.option}
            accessibilityRole="radio"
            accessibilityState={{ selected: editing ? fieldState(config.fields[editing]) === s : false }}
            onPress={() => {
              if (!editing) return;
              const next = applyFieldState(config.fields[editing], s);
              setEditing(null);
              void save({ [editing]: next });
            }}
          >
            <Text style={styles.optionMark}>
              {editing && fieldState(config.fields[editing]) === s ? '●' : '○'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionLabel}>{FIELD_STATE_LABEL[s]}</Text>
              <Text style={styles.optionHint}>{FIELD_STATE_HINT[s]}</Text>
            </View>
          </Pressable>
        ))}
      </BottomSheet>

      {/* Agregar campo: el catálogo es cerrado, el origen lo escribe el usuario mirando su archivo. */}
      <BottomSheet visible={adding} onClose={() => setAdding(false)} title="¿Qué campo querés agregar?">
        <Text style={styles.hint}>
          Después indicá de qué columna o etiqueta del archivo se lee.
        </Text>
        {sinEmparejar.map((f) => (
          <Pressable
            key={f}
            style={styles.option}
            onPress={() => {
              setAdding(false);
              void save({ [f]: { enabled: true, required: false } });
              setEditing(f);
            }}
          >
            <Text style={styles.optionMark}>+</Text>
            <Text style={styles.optionLabel}>{catalog[f]?.label ?? f}</Text>
          </Pressable>
        ))}
      </BottomSheet>

      {/* Nombre: la única decisión que el archivo no puede responder (§2.3). */}
      <BottomSheet visible={naming} onClose={() => setNaming(false)} title="¿Cómo viene el nombre?">
        <Text style={styles.hint}>Ejemplo: "MARTINEZ DURAN JUAN ANTONIO"</Text>
        {(['full', 'surnames-first', 'split-columns'] as NameOrder[]).map((o) => {
          const p = previewName('MARTINEZ DURAN JUAN ANTONIO', o);
          return (
            <Pressable
              key={o}
              style={styles.option}
              accessibilityRole="radio"
              accessibilityState={{ selected: config.nameOrder === o }}
              onPress={() => {
                setNaming(false);
                void save({}, { nameOrder: o });
              }}
            >
              <Text style={styles.optionMark}>{config.nameOrder === o ? '●' : '○'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionLabel}>{NAME_ORDER_LABEL[o]}</Text>
                {o === 'split-columns' ? (
                  <Text style={styles.optionHint}>Emparejás "Apellidos" y "Nombres" por su cuenta.</Text>
                ) : (
                  <>
                    <Text style={styles.optionHint}>Apellidos: {p.lastName}</Text>
                    <Text style={styles.optionHint}>Nombres: {p.firstName}</Text>
                  </>
                )}
              </View>
            </Pressable>
          );
        })}
      </BottomSheet>

      {daysRule?.from && !daysRule.calibrated && (
        <View style={styles.calibrateBar}>
          <Text style={styles.calibrateText}>
            Confirmá que "{daysRule.from}" son los días de atraso.
          </Text>
          <Button label="Confirmar" onPress={() => void save({ daysPastDue: { ...daysRule, calibrated: true } })} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  keyBox: { backgroundColor: COLORS.lightBg, borderRadius: 12, padding: SPACING.md, gap: SPACING.xs },
  keyTitle: { fontSize: 15, fontWeight: '600', color: COLORS.navy },
  hint: { fontSize: 13, color: COLORS.text2 },
  warn: { fontSize: 16, color: COLORS.warning },
  warnText: { fontSize: 12, color: COLORS.warningText, marginTop: 2, marginLeft: SPACING.md },
  subAction: { paddingVertical: SPACING.xs, marginLeft: SPACING.md },
  subActionText: { fontSize: 13, color: COLORS.slate },
  option: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.sm, alignItems: 'flex-start' },
  optionMark: { fontSize: 16, color: COLORS.navy, width: 20 },
  optionLabel: { fontSize: 15, color: COLORS.text, fontWeight: '500' },
  optionHint: { fontSize: 13, color: COLORS.text2, marginTop: 2 },
  calibrateBar: {
    padding: SPACING.lg,
    gap: SPACING.sm,
    backgroundColor: COLORS.warningBg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  calibrateText: { fontSize: 13, color: COLORS.warningText },
});
