import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationPhotos } from './location-photos';

const A = '/api/uploads/a.jpg';
const B = '/api/uploads/b.jpg';

beforeEach(() => vi.restoreAllMocks());

describe('LocationPhotos · fotos de la vivienda', () => {
  it('la primera es la principal y se marca como tal', () => {
    render(<LocationPhotos value={[A, B]} onChange={vi.fn()} />);
    expect(screen.getAllByText('Principal')).toHaveLength(1);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('«Hacer principal» pone esa foto primera sin perder las otras', async () => {
    const onChange = vi.fn();
    render(<LocationPhotos value={[A, B]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hacer principal' }));
    expect(onChange).toHaveBeenCalledWith([B, A]);
  });

  it('quitar una foto la saca de la lista', async () => {
    const onChange = vi.fn();
    render(<LocationPhotos value={[A, B]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar la foto 1' }));
    expect(onChange).toHaveBeenCalledWith([B]);
  });

  it('subir varias agrega todas al final, sin pisar la principal', async () => {
    const onChange = vi.fn();
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ url: `/api/uploads/new${++n}.jpg` }), { status: 200 }));
    render(<LocationPhotos value={[A]} onChange={onChange} />);
    const files = [new File(['x'], 'x.jpg', { type: 'image/jpeg' }), new File(['y'], 'y.jpg', { type: 'image/jpeg' })];
    await userEvent.upload(screen.getByTestId('location-photos-input'), files);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([A, '/api/uploads/new1.jpg', '/api/uploads/new2.jpg']));
  });

  it('si la subida falla lo dice y no cambia la lista', async () => {
    const onChange = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'El archivo supera los 8 MB' } }), { status: 400 }));
    render(<LocationPhotos value={[]} onChange={onChange} />);
    await userEvent.upload(screen.getByTestId('location-photos-input'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El archivo supera los 8 MB');
    expect(onChange).not.toHaveBeenCalled();
  });
});
