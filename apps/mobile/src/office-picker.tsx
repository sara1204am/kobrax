import { Text } from 'react-native';
import { COLORS, SPACING, TYPE } from '@/theme';
import { Chips, SectionLabel } from '@/ui';
import type { OfficeOption } from '@/office-choice';

/**
 * «¿En qué oficina se registra?» (F14 · F8, D-7). Solo se dibuja cuando hay más de una opción: con una sola el servidor la resuelve y la app no muestra nada.
 * Elegir es obligatorio (el guardado lo exige): un alta sin oficina la rechazaría el servidor.
 */
export function OfficePicker({ options, value, onChange }: { options: readonly OfficeOption[]; value: string | null; onChange: (id: string) => void }) {
  if (options.length < 2) return null;
  return (
    <>
      <SectionLabel>Oficina donde se registra</SectionLabel>
      <Chips options={options.map((o) => ({ value: o.id, label: o.name }))} value={value ?? ''} onChange={onChange} />
      {value === null && <Text style={{ ...TYPE.secondary, color: COLORS.muted, marginTop: SPACING.xs }}>Elige la oficina para poder guardar.</Text>}
    </>
  );
}
