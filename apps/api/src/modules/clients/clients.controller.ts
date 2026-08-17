import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClientsService } from './clients.service';
import {
  CreateAttachmentDto,
  CreateClientDto,
  CreateCollateralDto,
  CreateContactDto,
  CreateLocationDto,
  CreateRelationDto,
  ListClientsQueryDto,
  TimelineQueryDto,
  UpdateAttachmentDto,
  UpdateClientDto,
  UpdateCollateralDto,
  UpdateContactDto,
  UpdateLocationDto,
  UpdateRelationDto,
} from './dto/client.dto';

@Controller('clients')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  // ── Cliente ────────────────────────────────────────────────────────────────
  @Post()
  @Roles(Permission.CLIENT_WRITE)
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Get()
  @Roles(Permission.CLIENT_READ)
  list(@Query() query: ListClientsQueryDto) {
    return this.clients.list(query);
  }

  @Get(':id')
  @Roles(Permission.CLIENT_READ)
  /**
   * Quien puede ver al cliente puede verlo completo, y el revelado queda auditado
   * (`client/PII_REVEAL`). Antes exigía `CLIENT_PII_READ`, que el cobrador NO tiene: el formulario de
   * edición mostraba la PII enmascarada y guardarlo escribía la máscara encima del dato real.
   *
   * ponytail: los permisos finos son F3/P10 — se construye con la capacidad encendida y el guard se
   * cablea al final; no se ramifica por rol ahora.
   */
  findOne(@Param('id', ParseUUIDPipe) id: string, @Query('reveal') reveal?: string) {
    return this.clients.findOne(id, reveal === 'true');
  }

  @Patch(':id')
  @Roles(Permission.CLIENT_WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(id, dto);
  }

  @Delete(':id')
  @Roles(Permission.CLIENT_WRITE)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.clients.remove(id);
  }

  // ── Sub-recursos ───────────────────────────────────────────────────────────
  @Post(':id/contacts')
  @Roles(Permission.CLIENT_WRITE)
  addContact(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateContactDto) {
    return this.clients.addContact(id, dto);
  }

  @Patch(':id/contacts/:cid')
  @Roles(Permission.CLIENT_WRITE)
  updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.clients.updateContact(id, cid, dto);
  }

  @Delete(':id/contacts/:cid')
  @Roles(Permission.CLIENT_WRITE)
  @HttpCode(204)
  async removeContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
  ): Promise<void> {
    await this.clients.removeSub(id, 'contact', cid);
  }

  @Post(':id/locations')
  @Roles(Permission.CLIENT_WRITE)
  addLocation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLocationDto) {
    return this.clients.addLocation(id, dto);
  }

  /** Corregir una dirección o marcarle el punto sin perder su id, sus fotos ni su referencia. */
  @Patch(':id/locations/:lid')
  @Roles(Permission.CLIENT_WRITE)
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lid', ParseUUIDPipe) lid: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.clients.updateLocation(id, lid, dto);
  }

  @Delete(':id/locations/:lid')
  @Roles(Permission.CLIENT_WRITE)
  @HttpCode(204)
  async removeLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lid', ParseUUIDPipe) lid: string,
  ): Promise<void> {
    await this.clients.removeSub(id, 'location', lid);
  }

  @Post(':id/relations')
  @Roles(Permission.CLIENT_WRITE)
  addRelation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRelationDto) {
    return this.clients.addRelation(id, dto);
  }

  /** Editar al garante ya guardado. Sus teléfonos y ubicaciones van por sus propias rutas, con `relationId`. */
  @Patch(':id/relations/:rid')
  @Roles(Permission.CLIENT_WRITE)
  updateRelation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rid', ParseUUIDPipe) rid: string,
    @Body() dto: UpdateRelationDto,
  ) {
    return this.clients.updateRelation(id, rid, dto);
  }

  @Delete(':id/relations/:rid')
  @Roles(Permission.CLIENT_WRITE)
  @HttpCode(204)
  async removeRelation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rid', ParseUUIDPipe) rid: string,
  ): Promise<void> {
    await this.clients.removeSub(id, 'relation', rid);
  }

  /**
   * La bitácora: qué se hizo con esta persona, de todos sus créditos.
   *
   * Pide `client:read` porque es la ficha del cliente, pero **cada fuente entra sólo si quien mira
   * puede verla** (lo decide el service). Un solo permiso para las tres sería la puerta de atrás
   * para leer pagos sin `payment:read`.
   */
  @Get(':id/timeline')
  @Roles(Permission.CLIENT_READ)
  timeline(@Param('id', ParseUUIDPipe) id: string, @Query() query: TimelineQueryDto) {
    return this.clients.timeline(id, query);
  }

  // ── Garantías (el bien; la personal es el garante, que va arriba) ──────────
  @Post(':id/collaterals')
  @Roles(Permission.CLIENT_WRITE)
  addCollateral(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCollateralDto) {
    return this.clients.addCollateral(id, dto);
  }

  @Patch(':id/collaterals/:gid')
  @Roles(Permission.CLIENT_WRITE)
  updateCollateral(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body() dto: UpdateCollateralDto,
  ) {
    return this.clients.updateCollateral(id, gid, dto);
  }

  @Delete(':id/collaterals/:gid')
  @Roles(Permission.CLIENT_WRITE)
  @HttpCode(204)
  async removeCollateral(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
  ): Promise<void> {
    await this.clients.removeSub(id, 'collateral', gid);
  }

  @Post(':id/attachments')
  @Roles(Permission.CLIENT_WRITE)
  addAttachment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAttachmentDto) {
    return this.clients.addAttachment(id, dto);
  }

  /** Reclasificar un adjunto (el archivo no se toca; su hash es la prueba de que no cambió). */
  @Patch(':id/attachments/:aid')
  @Roles(Permission.CLIENT_WRITE)
  updateAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
    @Body() dto: UpdateAttachmentDto,
  ) {
    return this.clients.updateAttachment(id, aid, dto);
  }

  @Delete(':id/attachments/:aid')
  @Roles(Permission.CLIENT_WRITE)
  @HttpCode(204)
  async removeAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<void> {
    await this.clients.removeSub(id, 'attachment', aid);
  }
}
