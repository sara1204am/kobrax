import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS, SPACING } from '@/theme';
import { BottomSheet, Header, ListRow, SectionLabel } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { pickImportFile } from '@/file-picker';
import {
  applyFieldState,
  FIELD_STATE_HINT,
  FIELD_STATE_LABEL,
  fieldState,
  importService,
  NAME_ORDER_LABEL,
  previewName,
  type ColumnCandidate,
  type ConfigScreen,
  type FieldRule,
  type FieldState,
  type NameOrder,
  type PickedFile,
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
  // Lo que el archivo de muestra trajo. Vive sólo en memoria: es material de trabajo para
  // emparejar, no configuración — guardarlo obligaría a invalidarlo cuando el archivo cambie.
  const [labels, setLabels] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<ColumnCandidate[]>([]);
  const [starts, setStarts] = useState<{ text: string; count: number }[]>([]);
  const [headers, setHeaders] = useState<{ anchor: string; preview: string }[]>([]);
  const [pickingStart, setPickingStart] = useState(false);
  // El archivo de muestra queda a mano para releerlo cuando cambia cómo se corta.
  const [sample, setSample] = useState<PickedFile | null>(null);
  const [sourceFor, setSourceFor] = useState<string | null>(null); // campo al que se le elige origen

  const load = useCallback(async () => {
    const res = await importService.getConfig();
    if (res.status === 'ok') setScreen(res.data);
    else setError(res.status === 'offline' ? 'Sin conexión.' : 'No se pudo cargar la configuración');
  }, []);
  useEffect(() => void load(), [load]);

  // Las dos formas en PDF necesitan que el usuario señale UNA cosa antes de poder ofrecer
  // columnas, y es la misma pregunta con dos caras: dónde arranca la tabla.
  //  - bloques → qué etiqueta abre cada registro (`recordStart`), elegida por cuántas veces
  //    aparece: una por crédito;
  //  - tabla   → cuál de las filas de arriba son los encabezados (`tableAnchor`), elegida
  //    viéndolas enteras: un reporte trae título y fecha antes de la tabla.
  // Una planilla no pregunta nada: cada fila ya es un registro y la primera son los encabezados.
  const kind = screen?.config.profile.kind;
  const askStart = kind === 'pdf-blocks' ? 'record' : kind === 'pdf-rows' ? 'header' : null;
  const anchor = askStart === 'record' ? screen?.config.profile.recordStart : screen?.config.profile.tableAnchor;
  const needsStart = askStart !== null && !anchor;
  const startOptions =
    askStart === 'record'
      ? starts.map((c) => ({ value: c.text, label: c.text, hint: `${c.count} veces en el archivo` }))
      : headers.map((c) => ({ value: c.anchor, label: c.anchor, hint: c.preview }));

  /** Sube un archivo de muestra: la app lista lo que encontró para que el usuario empareje. */
  async function pickSample() {
    const picked = await pickImportFile();
    if (!picked) return;
    setSample(picked);
    await readSample(picked);
  }

  /**
   * Señalar dónde arranca la tabla cambia lo que el archivo puede ofrecer: hasta ahora era un
   * bloque suelto, ahora son N registros con sus columnas. Por eso se vuelve a leer la muestra
   * en vez de dejar en pantalla una lista que ya no corresponde.
   */
  async function chooseStart(value: string) {
    setPickingStart(false);
    // Va por `profile`, no por `fields`: no es un dato del crédito sino cómo se lee el archivo.
    // La forma no cambia, así que el emparejado hecho hasta acá se conserva.
    const key = askStart === 'record' ? 'recordStart' : 'tableAnchor';
    await save({}, { profile: { ...config.profile, [key]: value } });
    if (sample) await readSample(sample);
  }

  async function readSample(picked: PickedFile) {
    const res = await importService.readColumns(picked);
    if (res.status !== 'ok') {
      // El motivo real viene del backend (forma equivocada, Excel, PDF ilegible) y es lo único
      // accionable: mostrar "no se pudo leer" en su lugar borra la única pista que había.
      setError(
        res.status === 'error'
          ? res.message
          : res.status === 'offline'
            ? 'Sin conexión. El archivo se lee en el servidor.'
            : 'Tu sesión venció.',
      );
      return;
    }
    setLabels(res.labels);
    setCandidates(res.columnCandidates);
    setStarts(res.recordStartCandidates ?? []);
    setHeaders(res.headerCandidates ?? []);
    // Sin señalar dónde arranca la tabla, el PDF no se corta en créditos: no es que el archivo
    // esté vacío, es que todavía no sabemos leerlo. Se dice eso y se ofrece elegirlo.
    const offered = (res.recordStartCandidates?.length ?? 0) + (res.headerCandidates?.length ?? 0);
    setError(
      needsStart && offered > 0
        ? 'Falta indicar dónde arranca la tabla.'
        : res.labels.length === 0
          ? 'El archivo se leyó pero no se encontraron columnas.'
          : null,
    );
  }

  /** `null` en un campo = quitarlo del emparejado (lo resuelve el backend). */
  async function save(fields: Record<string, FieldRule | null>, extra: Record<string, unknown> = {}) {
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
  // La llave y el cliente se listan SIEMPRE, estén configurados o no: son los dos que el import no
  // puede suplir, y no verlos en la lista es exactamente cómo se llega a una cartera entera de
  // "SIN NOMBRE" sin que nada haya avisado.
  const locked = Object.keys(catalog).filter((f) => catalog[f]?.locked);
  const entries = [...new Set([...locked, ...Object.keys(config.fields)])]
    .map((f) => [f, config.fields[f] ?? {}] as [string, FieldRule])
    .filter(([f, r]) => catalog[f]?.locked || r.from || r.enabled !== false);
  // Los bloqueados no se ofrecen para "agregar": ya están arriba, con su aviso si les falta origen.
  const sinEmparejar = Object.keys(catalog).filter((f) => !config.fields[f]?.from && !catalog[f]?.locked);
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
            El campo no se puede cambiar (identifica a cada crédito), pero sí de qué etiqueta se lee:
            tocá "N° de crédito" en la lista y elegí la columna de tu archivo.
          </Text>
        </View>

        {/* Va ARRIBA del emparejado porque es su precondición: sin saber dónde empieza cada
            registro, el archivo es un solo bloque y no hay columnas que listar. */}
        {askStart && (
          <ListRow
            title={askStart === 'record' ? 'Dónde empieza cada registro' : 'Cuál es la fila de encabezados'}
            subtitle={
              anchor
                ? `"${anchor}"`
                : startOptions.length > 0
                  ? 'Sin elegir — tocá para ver las opciones del archivo'
                  : 'Subí un archivo de muestra para ver las opciones'
            }
            right={needsStart ? <Text style={styles.warn}>⚠</Text> : undefined}
            onPress={startOptions.length > 0 ? () => setPickingStart(true) : undefined}
          />
        )}

        {labels.length > 0 && (
          <Text style={styles.hint}>
            Del archivo de muestra: {labels.slice(0, 8).join(' · ')}
            {labels.length > 8 ? ` y ${labels.length - 8} más` : ''}
          </Text>
        )}

        {labels.length === 0 && (
          // Sin archivo de muestra no hay etiquetas que ofrecer: subirlo es la pieza que hace
          // configurable un formato que nunca vimos (§6.5).
          <Text style={styles.hint}>
            Subí un archivo de muestra: la app te muestra qué trae y vos decís qué es cada cosa.
          </Text>
        )}
        <SectionLabel>CAMPOS</SectionLabel>
        {entries.map(([field, rule]) => {
          const def = catalog[field];
          const state = fieldState(rule);
          const isName = field === 'clientName';
          const sinConfirmar = field === 'daysPastDue' && rule.from && !rule.calibrated;
          // Un campo sin origen no lee nada: el import lo deja vacío y no avisa. Duele más en
          // los que no se pueden apagar (llave y cliente), que es donde se nota tarde.
          const sinOrigen = !rule.from;
          return (
            <View key={field}>
              <ListRow
                title={def?.label ?? field}
                subtitle={`${rule.from ? `"${rule.from}"` : 'sin emparejar'} · ${FIELD_STATE_LABEL[state]}`}
                right={sinConfirmar || sinOrigen ? <Text style={styles.warn}>⚠</Text> : undefined}
                // Sin origen, elegirlo es lo único que tiene sentido hacer: se va derecho ahí en vez
                // de esconderlo detrás del menú de estado. La llave nunca elige estado (siempre
                // obligatoria y encendida), pero SÍ de dónde se lee: no todo sistema llama
                // "N° de crédito" a su identificador.
                onPress={sinOrigen || field === 'code' ? () => setSourceFor(field) : () => setEditing(field)}
              />
              {isName && (
                <Pressable onPress={() => setNaming(true)} style={styles.subAction}>
                  <Text style={styles.subActionText}>Cómo viene: {NAME_ORDER_LABEL[config.nameOrder]} ›</Text>
                </Pressable>
              )}
              {sinConfirmar && <Text style={styles.warnText}>Sin confirmar — revisá los valores</Text>}
              {sinOrigen && <Text style={styles.warnText}>Sin columna: este campo va a llegar vacío</Text>}
            </View>
          );
        })}

        <Button variant="ghost" label="Elegir un archivo de muestra" onPress={() => void pickSample()} />
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
        <Pressable
          style={styles.option}
          onPress={() => {
            setSourceFor(editing);
            setEditing(null);
          }}
        >
          <Text style={styles.optionMark}>⇄</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>De dónde se lee</Text>
            <Text style={styles.optionHint}>
              {editing && config.fields[editing]?.from ? `"${config.fields[editing]!.from}"` : 'Sin emparejar'}
            </Text>
          </View>
        </Pressable>
        {/* Quitar ≠ apagar: apagado el campo sigue en la lista para siempre. Un campo agregado
            por error tiene que poder salir. La llave y el cliente no se quitan (invariante 3). */}
        {editing && !catalog[editing]?.locked && (
          <Pressable
            style={styles.option}
            onPress={() => {
              const field = editing;
              setEditing(null);
              void save({ [field]: null });
            }}
          >
            <Text style={[styles.optionMark, { color: COLORS.danger }]}>✕</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionLabel, { color: COLORS.danger }]}>Quitar del emparejado</Text>
              <Text style={styles.optionHint}>Sale de la lista. Lo podés volver a agregar cuando quieras.</Text>
            </View>
          </Pressable>
        )}
      </BottomSheet>

      {/*
        Elegir el ORIGEN de un campo. Para los días de atraso se muestran los valores reales del
        archivo de muestra (§6.5.1): con `Dias Int.` y `Dias Mora` contiguas, el número al lado del
        cliente es lo único que deja distinguirlas — el usuario conoce su cartera, el test no.
      */}
      <BottomSheet visible={!!sourceFor} onClose={() => setSourceFor(null)} title="¿De dónde se lee?">
        {labels.length === 0 && candidates.length === 0 ? (
          <Text style={styles.hint}>Subí un archivo de muestra para ver qué trae.</Text>
        ) : null}
        {(sourceFor === 'daysPastDue' ? candidates : []).map((c) => (
          <Pressable
            key={c.header}
            style={styles.option}
            onPress={() => {
              const field = sourceFor!;
              setSourceFor(null);
              // Cambiar la columna vuelve `calibrated` a false: confirmar es un acto aparte de
              // elegir (invariante 7). El backend lo rechaza si llegan juntos.
              void save({ [field]: { ...config.fields[field], from: c.header, in: 'table', calibrated: false } });
            }}
          >
            <Text style={styles.optionMark}>{config.fields[sourceFor!]?.from === c.header ? '●' : '○'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionLabel}>{c.header}</Text>
              {c.samples.map((s) => (
                <Text key={s.label} style={styles.optionHint}>
                  {s.label} — {s.value ?? '(vacío)'}
                </Text>
              ))}
            </View>
          </Pressable>
        ))}
        {labels.map((l) => (
          <Pressable
            key={l}
            style={styles.option}
            onPress={() => {
              const field = sourceFor!;
              setSourceFor(null);
              // `?? {}` porque el campo puede no existir todavía: se agrega y se empareja en un
              // solo paso, que es el único en que la configuración es coherente.
              void save({ [field]: { required: false, ...(config.fields[field] ?? {}), from: l, enabled: true } });
            }}
          >
            <Text style={styles.optionMark}>{config.fields[sourceFor!]?.from === l ? '●' : '○'}</Text>
            <Text style={styles.optionLabel}>{l}</Text>
          </Pressable>
        ))}
      </BottomSheet>

      {/*
        Dónde empieza cada registro. La app no lo adivina: le acerca los textos que se repiten con
        cuántas veces aparecen —"Cliente · 6 veces" en un archivo de 6 créditos es inconfundible—
        y el usuario, que conoce su archivo, elige. Es lo que hace configurable un PDF sin preset.
      */}
      <BottomSheet
        visible={pickingStart}
        onClose={() => setPickingStart(false)}
        title={askStart === 'record' ? '¿Con qué texto empieza cada registro?' : '¿Cuál fila son los encabezados?'}
      >
        <Text style={styles.hint}>
          {askStart === 'record'
            ? 'Se repite una vez por crédito. Si tu archivo trae 20 créditos, buscá el que aparezca 20 veces.'
            : 'Son las primeras filas del archivo. Elegí la que tiene los nombres de las columnas.'}
        </Text>
        {startOptions.map((o) => (
          <Pressable key={o.value} style={styles.option} onPress={() => void chooseStart(o.value)}>
            <Text style={styles.optionMark}>{anchor === o.value ? '●' : '○'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionLabel}>{o.label}</Text>
              <Text style={styles.optionHint} numberOfLines={2}>
                {o.hint}
              </Text>
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
              // No se guarda nada acá: un campo sin origen no significa nada, y guardarlo abría una
              // carrera —este PATCH y el de la columna elegida se pisaban, y ganaba el que llegaba
              // último—. Así el campo nace ya emparejado, de una sola escritura.
              setSourceFor(f);
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
