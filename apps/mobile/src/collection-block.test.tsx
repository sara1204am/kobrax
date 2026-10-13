// ui.tsx importa el net store (NetInfo nativo) y los íconos (expo-font): acá solo importan textos y tonos.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('./catalogs.service', () => ({
  listCatalogCached: async () => ({
    status: 'ok',
    total: 2,
    data: [
      { id: '1', catalog: 'COLLECTION_MODALITY', code: 'AT_BUSINESS', label: 'Visita en el negocio', sortOrder: 1, metadata: null },
      { id: '2', catalog: 'COLLECTION_MODALITY', code: 'PICK_UP', label: 'Recoger la cuota', sortOrder: 2, metadata: null },
    ],
  }),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { emptyCollectionForm, type CollectionProfileForm } from '@kobrax/shared';
import { CollectionBlock, describeCollection } from './collection-block';

describe('describeCollection', () => {
  it('arma una línea con lo que hay, en orden', () => {
    const labels = new Map([['PICK_UP', 'Recoger la cuota']]);
    expect(
      describeCollection({ modality: 'PICK_UP', frequency: 'DAILY', window: { from: '08:00', to: '10:00' }, days: [1, 2, 3], handoverBy: 'EMPLOYEE' }, labels),
    ).toBe('Recoger la cuota · Todos los días · 08:00–10:00 · L M X · Un empleado');
  });

  it('un lugar sin perfil no muestra nada', () => {
    expect(describeCollection(undefined)).toBe('');
    expect(describeCollection(null)).toBe('');
    expect(describeCollection({})).toBe('');
  });

  it('sin el rótulo del catálogo usa el código: no inventa un nombre', () => {
    expect(describeCollection({ modality: 'RARA' })).toBe('RARA');
  });

  it('todos los días de la semana no se enumeran', () => {
    expect(describeCollection({ days: [1, 2, 3, 4, 5, 6, 7] })).toBe('');
  });
});

describe('CollectionBlock', () => {
  const setup = (initial: CollectionProfileForm = emptyCollectionForm()) => {
    const onChange = jest.fn();
    render(<CollectionBlock value={initial} onChange={onChange} />);
    return onChange;
  };

  it('ofrece las modalidades del catálogo y devuelve la elegida', async () => {
    const onChange = setup();
    await waitFor(() => screen.getByText('Recoger la cuota'));
    fireEvent.press(screen.getByText('Recoger la cuota'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ modality: 'PICK_UP' }));
  });

  it('marcar un día lo agrega ordenado', () => {
    const onChange = setup({ ...emptyCollectionForm(), days: [3] });
    fireEvent.press(screen.getByText('L'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ days: [1, 3] }));
  });

  it('desmarcar un día lo quita', () => {
    const onChange = setup({ ...emptyCollectionForm(), days: [1, 3] });
    fireEvent.press(screen.getByText('L'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ days: [3] }));
  });

  it('🔴 una franja con las horas al revés se marca', () => {
    setup({ ...emptyCollectionForm(), windowFrom: '18:00', windowTo: '08:00' });
    expect(screen.getByText(/La franja necesita las dos horas/)).toBeTruthy();
  });

  it('una franja válida no muestra error', () => {
    setup({ ...emptyCollectionForm(), windowFrom: '08:00', windowTo: '10:00' });
    expect(screen.queryByText(/La franja necesita las dos horas/)).toBeNull();
  });

  it('elegir quién entrega cambia el perfil', () => {
    const onChange = setup();
    fireEvent.press(screen.getByText('Un familiar'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ handoverBy: 'FAMILY' }));
  });
});
