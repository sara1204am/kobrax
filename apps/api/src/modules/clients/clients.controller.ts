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
  CreateContactDto,
  CreateLocationDto,
  CreateRelationDto,
  ListClientsQueryDto,
  UpdateClientDto,
  UpdateContactDto,
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

  @Delete(':id/relations/:rid')
  @Roles(Permission.CLIENT_WRITE)
  @HttpCode(204)
  async removeRelation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rid', ParseUUIDPipe) rid: string,
  ): Promise<void> {
    await this.clients.removeSub(id, 'relation', rid);
  }

  @Post(':id/attachments')
  @Roles(Permission.CLIENT_WRITE)
  addAttachment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAttachmentDto) {
    return this.clients.addAttachment(id, dto);
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
