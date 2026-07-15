import { useCallback, useRef, useState, type ReactNode } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, UIManager, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { choosePhoto } from '@/photo';
import { Chips, Header, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import {
  buildClientePayload,
  canSubmitCliente,
  emptyContact,
  emptyLocation,
  emptyRelation,
  initialCliente,
  type ClienteForm,
  type ContactRow,
  type LocationRow,
  type RelationRow,
} from '@/cliente-form';
import { createClient } from '@/clients.service';
import { uploadImage } from '@/uploads.service';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const GENDER = [{ value: '', label: 'Sin especificar' }, { value: 'M', label: 'Masculino' }, { value: 'F', label: 'Femenino' }, { value: 'O', label: 'Otro' }];
const CLIENT_TYPE = [{ value: 'PERSON', label: 'Persona' }, { value: 'COMPANY', label: 'Empresa' }] as const;
const RISK = [{ value: '', label: '—' }, { value: 'LOW', label: 'Bajo' }, { value: 'MEDIUM', label: 'Medio' }, { value: 'HIGH', label: 'Alto' }];
const STATUS = [{ value: 'ACTIVE', label: 'Activo' }, { value: 'INACTIVE', label: 'Inactivo' }, { value: 'BLOCKED', label: 'Bloqueado' }] as const;
const CONTACT_TYPE = [{ value: 'PHONE', label: 'Teléfono' }, { value: 'EMAIL', label: 'Email' }] as const;
const LOCATION_TYPE = [{ value: 'HOME', label: 'Casa' }, { value: 'WORK', label: 'Trabajo' }, { value: 'GUARANTOR', label: 'Garante' }, { value: 'FAMILY', label: 'Familia' }, { value: 'OTHER', label: 'Otra' }] as const;
const RELATION_TYPE = [{ value: 'GUARANTOR', label: 'Garante' }, { value: 'FAMILY', label: 'Familia' }, { value: 'COWORKER', label: 'Compañero' }, { value: 'NEIGHBOR', label: 'Vecino' }, { value: 'OTHER', label: 'Otro' }] as const;
const COORD_MODE = [{ value: 'manual', label: '✏️ Manual' }, { value: 'gps', label: '📍 Mi ubicación' }, { value: 'map', label: '🗺️ Mapa' }] as const;

/** V1 — Registro de cliente (§5.1), diseño acordeón: identificación + N contactos + N ubicaciones + N relaciones. */
export default function NuevoClienteScreen() {
  const [form, setForm] = useState<ClienteForm>(initialCliente);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);
  const genId = () => `row-${++idRef.current}`;

  const set = useCallback((patch: Partial<ClienteForm>) => setForm((s) => ({ ...s, ...patch })), []);

  // ── Contactos ──
  const addContact = () => setForm((s) => ({ ...s, contacts: [...s.contacts, emptyContact(genId(), s.contacts.length === 0)] }));
  const removeContact = (id: string) => setForm((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== id) }));
  const updContact = (id: string, patch: Partial<ContactRow>) => setForm((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const setPrimary = (id: string) => setForm((s) => ({ ...s, contacts: s.contacts.map((c) => ({ ...c, isPrimary: c.id === id })) }));

  // ── Ubicaciones ──
  const addLocation = () => setForm((s) => ({ ...s, locations: [...s.locations, emptyLocation(genId())] }));
  const removeLocation = (id: string) => setForm((s) => ({ ...s, locations: s.locations.filter((l) => l.id !== id) }));
  const updLocation = (id: string, patch: Partial<LocationRow>) => setForm((s) => ({ ...s, locations: s.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const captureGps = useCallback(async (id: string) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return setError('Sin permiso de ubicación — podés cargar lat/long a mano.');
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    updLocation(id, { latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) });
  }, []);

  const addPhoto = useCallback(async (id: string) => {
    const pick = await choosePhoto();
    if (!pick) return;
    const up = await uploadImage(pick.uri, pick.mimeType);
    if (up.status === 'ok') setForm((s) => ({ ...s, locations: s.locations.map((l) => (l.id === id ? { ...l, photoUrls: [...l.photoUrls, up.url] } : l)) }));
    else setError('No se pudo subir la foto.');
  }, []);
  const removePhoto = (id: string, url: string) => setForm((s) => ({ ...s, locations: s.locations.map((l) => (l.id === id ? { ...l, photoUrls: l.photoUrls.filter((u) => u !== url) } : l)) }));

  // ── Relaciones ──
  const addRelation = () => setForm((s) => ({ ...s, relations: [...s.relations, emptyRelation(genId())] }));
  const removeRelation = (id: string) => setForm((s) => ({ ...s, relations: s.relations.filter((r) => r.id !== id) }));
  const updRelation = (id: string, patch: Partial<RelationRow>) => setForm((s) => ({ ...s, relations: s.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const submit = useCallback(
    async (thenLoan: boolean) => {
      setSaving(true);
      setError(null);
      const res = await createClient(buildClientePayload(form));
      setSaving(false);
      if (res.status === 'ok') {
        const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim();
        if (thenLoan) router.replace({ pathname: '/prestamo/nuevo', params: { clientId: res.data.id, name } });
        else router.back();
        return;
      }
      if (res.status === 'unauthenticated') return setError('Tu sesión venció. Volvé a iniciar sesión.');
      if (res.status === 'offline') return setError('Sin conexión — no se guardó. Reintentá.');
      setError(res.message); // "Ya existe un cliente con ese documento" en duplicado (§5.1)
    },
    [form],
  );

  const disabled = saving || !canSubmitCliente(form);
  const isCompany = form.clientType === 'COMPANY';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nuevo cliente" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        <Accordion icon="👤" title="Identificación" defaultOpen>
          <SectionLabel>Tipo de cliente</SectionLabel>
          <Chips options={CLIENT_TYPE} value={form.clientType} onChange={(v) => set({ clientType: v })} />
          <Field label={isCompany ? 'Razón social' : 'Nombre'} value={isCompany ? form.businessName : form.firstName} onChangeText={(t) => set(isCompany ? { businessName: t } : { firstName: t })} autoCapitalize="words" placeholder={isCompany ? 'Nombre del negocio' : 'Juan'} />
          <Field label="Apellido" value={form.lastName} onChangeText={(t) => set({ lastName: t })} autoCapitalize="words" placeholder="Pérez" />
          <Field label="Documento (CI/RUC)" value={form.nationalId} onChangeText={(t) => set({ nationalId: t })} placeholder="Opcional" />
          <SectionLabel>Género</SectionLabel>
          <Chips options={GENDER} value={form.gender} onChange={(v) => set({ gender: v })} />
          <SectionLabel>Segmento de riesgo</SectionLabel>
          <Chips options={RISK} value={form.riskSegment} onChange={(v) => set({ riskSegment: v })} />
          <SectionLabel>Estado</SectionLabel>
          <Chips options={STATUS} value={form.status} onChange={(v) => set({ status: v })} />
        </Accordion>

        <Accordion icon="📞" title="Contactos" badge={form.contacts.length} defaultOpen>
          {form.contacts.map((c) => (
            <ItemCard key={c.id} title={`${c.contactType === 'EMAIL' ? '📧' : '📱'} ${c.contactType === 'EMAIL' ? 'Correo' : 'Teléfono'}`} onRemove={() => removeContact(c.id)}>
              <SectionLabel>Tipo</SectionLabel>
              <Chips options={CONTACT_TYPE} value={c.contactType} onChange={(v) => updContact(c.id, { contactType: v })} />
              <Field label={c.contactType === 'EMAIL' ? 'Correo' : 'Número'} value={c.value} onChangeText={(t) => updContact(c.id, { value: t })} keyboardType={c.contactType === 'EMAIL' ? 'email-address' : 'phone-pad'} autoCapitalize="none" placeholder={c.contactType === 'EMAIL' ? 'correo@ejemplo.com' : '70000000'} />
              {c.contactType === 'PHONE' && (
                <ToggleRow label="Tiene WhatsApp" value={c.hasWhatsApp} onValueChange={(v) => updContact(c.id, { hasWhatsApp: v })} />
              )}
              <ToggleRow label="Contacto principal" value={c.isPrimary} onValueChange={() => setPrimary(c.id)} />
            </ItemCard>
          ))}
          <AddButton label="+ Agregar contacto" onPress={addContact} />
        </Accordion>

        <Accordion icon="📍" title="Ubicaciones" badge={form.locations.length} defaultOpen>
          {form.locations.map((l) => (
            <ItemCard key={l.id} title="🏠 Ubicación" onRemove={() => removeLocation(l.id)}>
              <SectionLabel>Tipo de ubicación</SectionLabel>
              <Chips options={LOCATION_TYPE} value={l.locationType} onChange={(v) => updLocation(l.id, { locationType: v })} />
              <Field label="Dirección" value={l.address} onChangeText={(t) => updLocation(l.id, { address: t })} placeholder="Calle y número" />
              <Field label="Zona / Barrio" value={l.zone} onChangeText={(t) => updLocation(l.id, { zone: t })} placeholder="Zona o barrio" />

              <SectionLabel>Capturar coordenadas</SectionLabel>
              <Chips options={COORD_MODE} value={l.coordMode} onChange={(v) => updLocation(l.id, { coordMode: v })} />
              {l.coordMode === 'manual' && (
                <View style={styles.coordGrid}>
                  <View style={{ flex: 1 }}>
                    <Field label="Latitud" value={l.latitude} onChangeText={(t) => updLocation(l.id, { latitude: t })} placeholder="-12.0464" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Longitud" value={l.longitude} onChangeText={(t) => updLocation(l.id, { longitude: t })} placeholder="-77.0428" />
                  </View>
                </View>
              )}
              {l.coordMode === 'gps' && (
                <Pressable style={styles.capture} onPress={() => captureGps(l.id)} accessibilityRole="button">
                  <Text style={styles.captureText}>{l.latitude ? `📍 ${l.latitude}, ${l.longitude}` : '📍 Capturar mi ubicación'}</Text>
                </Pressable>
              )}
              {l.coordMode === 'map' && (
                <Pressable style={styles.capture} onPress={() => setError('El mapa llega pronto — usá Manual o Mi ubicación.')} accessibilityRole="button">
                  <Text style={styles.captureText}>🗺️ Abrir mapa (próximamente)</Text>
                </Pressable>
              )}

              <Field label="Referencia / Notas" value={l.referenceNotes} onChangeText={(t) => updLocation(l.id, { referenceNotes: t })} placeholder="Portón verde frente a la cancha" />
              <SectionLabel>Fotos de la ubicación</SectionLabel>
              {l.photoUrls.length > 0 && (
                <View style={styles.photoRow}>
                  {l.photoUrls.map((u, i) => (
                    <View key={u + i} style={styles.photoThumb}>
                      <Text style={styles.photoOk}>✓</Text>
                      <Pressable style={styles.photoDel} onPress={() => removePhoto(l.id, u)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Quitar foto">
                        <Text style={styles.photoDelText}>×</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <Pressable style={styles.photoBox} onPress={() => addPhoto(l.id)} accessibilityRole="button" accessibilityLabel="Agregar foto">
                <Text style={styles.photoBoxIcon}>📷</Text>
                <Text style={styles.photoBoxHint}>Agregar foto</Text>
              </Pressable>
            </ItemCard>
          ))}
          <AddButton label="+ Agregar ubicación" onPress={addLocation} />
        </Accordion>

        <Accordion icon="👥" title="Garantes y contactos" badge={form.relations.length} defaultOpen>
          {form.relations.map((r) => (
            <ItemCard key={r.id} title={`👤 ${r.relatedName || 'Nueva relación'}`} onRemove={() => removeRelation(r.id)}>
              <Field label="Nombre" value={r.relatedName} onChangeText={(t) => updRelation(r.id, { relatedName: t })} autoCapitalize="words" placeholder="Nombre completo" />
              <SectionLabel>Tipo de relación</SectionLabel>
              <Chips options={RELATION_TYPE} value={r.relationshipType} onChange={(v) => updRelation(r.id, { relationshipType: v })} />
              <SectionLabel>Género</SectionLabel>
              <Chips options={GENDER} value={r.gender} onChange={(v) => updRelation(r.id, { gender: v })} />
              <Field label="Teléfono" value={r.phone} onChangeText={(t) => updRelation(r.id, { phone: t })} keyboardType="phone-pad" placeholder="Opcional" />
              <ToggleRow label="Es contactable" value={r.isContactable} onValueChange={(v) => updRelation(r.id, { isContactable: v })} />
              <Field label="Notas" value={r.notes} onChangeText={(t) => updRelation(r.id, { notes: t })} placeholder="Información adicional" />
            </ItemCard>
          ))}
          <AddButton label="+ Agregar contacto" onPress={addRelation} />
        </Accordion>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar y agregar préstamo" onPress={() => submit(true)} loading={saving} disabled={disabled} />
        <Button label="Solo guardar cliente" variant="ghost" onPress={() => submit(false)} disabled={disabled} />
      </View>
    </View>
  );
}

/** Sección plegable con ícono, título y badge de conteo (diseño acordeón). */
function Accordion({ icon, title, badge, defaultOpen, children }: { icon: string; title: string; badge?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };
  return (
    <View style={styles.acc}>
      <Pressable onPress={toggle} style={[styles.accHeader, open && styles.accHeaderOpen]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.accIcon}>{icon}</Text>
        <Text style={[styles.accTitle, open && styles.accTitleOpen]}>{title}</Text>
        {badge != null && (
          <View style={[styles.accBadge, open && styles.accBadgeOpen]}>
            <Text style={[styles.accBadgeText, open && styles.accBadgeTextOpen]}>{badge}</Text>
          </View>
        )}
        <Text style={[styles.accChevron, open && styles.accTitleOpen]}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && <View style={styles.accBody}>{children}</View>}
    </View>
  );
}

/** Tarjeta de ítem repetible (contacto/ubicación/relación) con botón de quitar. */
function ItemCard({ title, onRemove, children }: { title: string; onRemove: () => void; children: ReactNode }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quitar" style={styles.itemRemove}>
          <Text style={styles.itemRemoveText}>×</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.add} onPress={onPress} accessibilityRole="button">
      <Text style={styles.addText}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: COLORS.purple, false: COLORS.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.md },
  acc: { borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, overflow: 'hidden' },
  accHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.lightBg },
  accHeaderOpen: { backgroundColor: COLORS.purple },
  accIcon: { fontSize: 18 },
  accTitle: { ...TYPE.h3, color: COLORS.navy, flex: 1 },
  accTitleOpen: { color: COLORS.white },
  accBadge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: RADIUS.pill, backgroundColor: COLORS.border, alignItems: 'center' },
  accBadgeOpen: { backgroundColor: 'rgba(255,255,255,0.3)' },
  accBadgeText: { ...TYPE.caption, color: COLORS.text2, fontWeight: '700' },
  accBadgeTextOpen: { color: COLORS.white },
  accChevron: { fontSize: 16, color: COLORS.navy },
  accBody: { padding: SPACING.md, gap: SPACING.xs },
  item: { borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.sm, gap: SPACING.xs, backgroundColor: COLORS.bg },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: SPACING.sm, marginBottom: SPACING.xs },
  itemTitle: { ...TYPE.secondary, color: COLORS.purple, fontWeight: '700' },
  itemRemove: { width: 26, height: 26, borderRadius: 6, backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center' },
  itemRemoveText: { color: COLORS.danger, fontSize: 18, lineHeight: 20, fontWeight: '700' },
  add: { paddingVertical: SPACING.md, borderRadius: RADIUS.input, borderWidth: 1.5, borderColor: COLORS.periwinkle, borderStyle: 'dashed', alignItems: 'center', backgroundColor: COLORS.highlight },
  addText: { ...TYPE.secondary, color: COLORS.purple, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.xs },
  toggleLabel: { ...TYPE.body, color: COLORS.text },
  capture: { height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.periwinkle, backgroundColor: COLORS.highlight, marginVertical: SPACING.xs },
  captureText: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
  coordGrid: { flexDirection: 'row', gap: SPACING.sm },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm },
  photoThumb: { width: 56, height: 56, borderRadius: RADIUS.input, backgroundColor: COLORS.successBg, alignItems: 'center', justifyContent: 'center' },
  photoOk: { color: COLORS.success, fontSize: 20, fontWeight: '700' },
  photoDel: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center' },
  photoDelText: { color: COLORS.danger, fontSize: 14, lineHeight: 16, fontWeight: '700' },
  photoBox: { minHeight: 120, borderRadius: RADIUS.card, borderWidth: 2, borderColor: COLORS.periwinkle, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, backgroundColor: COLORS.highlight },
  photoBoxIcon: { fontSize: 34 },
  photoBoxHint: { ...TYPE.secondary, color: COLORS.purple, fontWeight: '600' },
  footer: { padding: SPACING.lg, gap: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
});
