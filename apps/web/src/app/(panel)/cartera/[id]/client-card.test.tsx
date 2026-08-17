import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ClientDetail } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { ClientCard } from './client-card';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** Como lo devuelve la API sin `reveal`: todo tokenizado. */
const TAPADO: ClientDetail = {
  id: 'cl-1',
  clientType: 'PERSON',
  firstName: 'Ana',
  lastName: 'Ruiz',
  nationalId: '1234***',
  status: 'ACTIVE',
  contacts: [{ id: 'ct-1', contactType: 'PHONE', value: '7****23', isPrimary: true }],
  locations: [{ id: 'lo-1', locationType: 'HOME', address: 'Calle ****' }],
};

const EN_CLARO: ClientDetail = {
  ...TAPADO,
  nationalId: '12345678',
  contacts: [{ id: 'ct-1', contactType: 'PHONE', value: '70012323', isPrimary: true }],
  locations: [{ id: 'lo-1', locationType: 'HOME', address: 'Calle Falsa 123' }],
};

function renderCard(client = TAPADO, permissions = ['client:read', 'client:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <ClientCard client={client} creditOptions={[]} currency="BOB" collateralTypes={[]} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

/** Los «Mostrar»: uno por cada dato tapado, y todos disparan el mismo revelado. */
const mostrar = () => screen.queryAllByRole('button', { name: 'Mostrar' });
/** El «Editar» de una sección, buscado dentro de su propio bloque. */
const editarDe = (seccion: string) =>
  within(screen.getByRole('region', { name: seccion })).getByRole('button', { name: 'Editar' });

describe('ClientCard — la PII se revela con un click, no sola', () => {
  it('abre tapada: ni el documento ni el teléfono ni la dirección están en claro', () => {
    renderCard();
    expect(screen.getByText('1234***')).toBeInTheDocument();
    expect(screen.queryByText('12345678')).not.toBeInTheDocument();
    expect(screen.queryByText('70012323')).not.toBeInTheDocument();
    expect(screen.queryByText('Calle Falsa 123')).not.toBeInTheDocument();
  });

  /**
   * El revelado deja rastro en la auditoría, así que tiene que salir de un click. Si la ficha lo
   * pidiera al abrirse, el registro se llenaría de ruido y sería inútil el día que haga falta.
   */
  it('no llama al revelado hasta que alguien lo pide', async () => {
    let pedidos = 0;
    server.use(
      http.post('*/api/clients/cl-1/reveal', () => {
        pedidos += 1;
        return HttpResponse.json(EN_CLARO);
      }),
    );

    renderCard();
    expect(pedidos).toBe(0);

    await userEvent.click(mostrar()[0]!);
    expect(await screen.findByText('12345678')).toBeInTheDocument();
    expect(pedidos).toBe(1);
  });

  /**
   * 🔴 **Un solo pedido, aunque los botones sean varios.**
   *
   * Cada teléfono y cada dirección tienen su «Mostrar», pero todos revelan la MISMA ficha: la
   * respuesta la reemplaza entera —enmascarada y en claro son la misma ficha con distinta
   * profundidad—, así que después del primer click no queda ningún botón que tocar. Eso es lo que
   * mantiene una sola entrada en la auditoría por persona que mira.
   */
  it('al revelar, también aparecen el teléfono y la dirección completos', async () => {
    server.use(http.post('*/api/clients/cl-1/reveal', () => HttpResponse.json(EN_CLARO)));

    renderCard();
    expect(mostrar().length).toBeGreaterThan(1); // uno por teléfono y por dirección
    await userEvent.click(mostrar()[0]!);

    expect(await screen.findByText('70012323')).toBeInTheDocument();
    expect(screen.getByText('Calle Falsa 123')).toBeInTheDocument();
    expect(mostrar()).toHaveLength(0);
  });

  it('si el servidor dice que no, la ficha se queda tapada', async () => {
    server.use(
      http.post('*/api/clients/cl-1/reveal', () =>
        HttpResponse.json({ error: { code: 'AUTH_002', message: 'Sin permiso' } }, { status: 403 }),
      ),
    );

    renderCard();
    await userEvent.click(mostrar()[0]!);

    expect(await screen.findByText('Sin permiso')).toBeInTheDocument();
    expect(screen.getByText('1234***')).toBeInTheDocument();
    expect(screen.queryByText('12345678')).not.toBeInTheDocument();
  });

  it('sin permiso de escritura no ofrece editar', () => {
    renderCard(TAPADO, ['client:read']);
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});

describe('ClientCard — se corrige por secciones, sin salir de la ficha', () => {
  /**
   * 🔴 **La prueba que protege el bug caro.** El formulario se hidrata de lo que hay en pantalla: si
   * abriera con la ficha tapada, guardar escribiría `1234***` encima del carnet real. Ya pasó una
   * vez en el móvil. Por eso «Editar» revela **antes** de abrir los campos.
   */
  it('«Editar» revela primero: el formulario nunca abre con la máscara', async () => {
    let pedidos = 0;
    server.use(
      http.post('*/api/clients/cl-1/reveal', () => {
        pedidos += 1;
        return HttpResponse.json(EN_CLARO);
      }),
    );

    renderCard();
    await userEvent.click(editarDe('Identificación'));

    expect(pedidos).toBe(1);
    const documento = await screen.findByLabelText('Documento');
    expect(documento).toHaveValue('12345678');
  });

  /**
   * 🔴 Tocar «Agregar garante» abría **la pantalla de edición entera**, con otro título y otro
   * orden. Ahora sólo cambia esa sección: el resto de la ficha sigue detrás.
   */
  it('«Agregar garante» abre el modal de garantes, no otra pantalla', async () => {
    server.use(http.post('*/api/clients/cl-1/reveal', () => HttpResponse.json(EN_CLARO)));

    renderCard();
    // La ficha sigue en pantalla: el nombre del cliente no se fue a ningún lado.
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar garante' }));

    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('Garantes y contactos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ana Ruiz' })).toBeInTheDocument();
  });

  /** Las cinco secciones abren el MISMO modal: una sola forma de corregir. */
  it('el teléfono también se corrige en modal, ya revelado', async () => {
    server.use(http.post('*/api/clients/cl-1/reveal', () => HttpResponse.json(EN_CLARO)));

    renderCard();
    await userEvent.click(editarDe('Contacto'));

    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByDisplayValue('70012323')).toBeInTheDocument();
  });

  /** 🔴 El estado va pegado al nombre, no a media pantalla entre los botones de acción. */
  it('la etiqueta de estado vive junto al nombre del cliente', () => {
    renderCard();
    const encabezado = screen.getByRole('heading', { name: 'Ana Ruiz' }).parentElement!;
    expect(within(encabezado).getByText('Activo')).toBeInTheDocument();
  });
});
