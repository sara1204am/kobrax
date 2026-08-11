/**
 * Lógica pura del alta de cliente (V1, §5.1) — versión acordeón: identificación + N contactos +
 * N ubicaciones + N relaciones/garantes.
 *
 * ⚠️ **Se mudó a `@kobrax/shared`** (F9 · W3): el panel web da de alta y edita los mismos clientes
 * contra los mismos endpoints, y las tres reglas del modelo que viven acá —WhatsApp como tipo
 * aparte, las filas vacías que se descartan, y `serverId`— no se escriben dos veces. Este archivo
 * re-exporta para no tocar a quien ya lo importaba.
 */
export {
  buildClientePayload,
  canSubmitCliente,
  clienteEnPunto,
  contactPayload,
  emptyContact,
  emptyLocation,
  emptyRelation,
  hasLocationData,
  hydrateCliente,
  initialCliente,
  locationPayload,
  mapContacts,
  mapLocations,
  relationPayload,
  type ClienteForm,
  type ClientTypeValue,
  type ContactRow,
  type ContactTypeValue,
  type CoordMode,
  type LocationRow,
  type LocationTypeValue,
  type RelationRow,
  type RelationTypeValue,
  type RowFromServer,
  type StatusValue,
} from '@kobrax/shared';
