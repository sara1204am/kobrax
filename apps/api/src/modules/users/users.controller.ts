import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { UsersService } from './users.service';
import { MemberDetailService, decodeCursor } from './member-detail.service';
import { InviteMemberDto, UpdateMemberDto, UpdateProfileDto } from './dto/user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly detail: MemberDetailService,
  ) {}

  // `me/profile` va antes que `:id` por claridad; no colisionan (2 segmentos vs 1).
  // Sin @Roles: es el propio perfil. Exigir un permiso dejaría al COLLECTOR sin
  // poder corregirse el teléfono.
  @Get('me/profile')
  getMyProfile() {
    return this.users.getMyProfile();
  }

  @Patch('me/profile')
  updateMyProfile(@Body() dto: UpdateProfileDto) {
    return this.users.updateMyProfile(dto);
  }

  @Get()
  @Roles(Permission.USER_READ)
  list() {
    return this.users.list();
  }

  /**
   * La ficha de un miembro. Los cuatro `GET :id/…` validan en el servidor que la persona sea de ESTA cuenta (404 si no)
   * y cada uno pide su propio permiso: la lista de accesos y la auditoría son más sensibles que el nombre.
   */
  @Get(':id')
  @Roles(Permission.USER_READ)
  getMember(@Param('id', ParseUUIDPipe) id: string) {
    return this.detail.detail(id);
  }

  @Get(':id/activity')
  @Roles(Permission.USER_READ)
  activity(@Param('id', ParseUUIDPipe) id: string, @Query('days') days?: string) {
    return this.detail.activity(id, Number(days));
  }

  /** Los dos listados que crecen sin tope paginan por cursor (instante e id del último elemento): `?before=<ISO>|<id>&limit=`. */
  @Get(':id/activity/events')
  @Roles(Permission.USER_READ)
  activityEvents(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('days') days?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.detail.activityEvents(id, Number(days), decodeCursor(before), Number(limit));
  }

  @Get(':id/connections')
  @Roles(Permission.USER_WRITE)
  connections(@Param('id', ParseUUIDPipe) id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.detail.connections(id, decodeCursor(before), Number(limit));
  }

  @Get(':id/audit')
  @Roles(Permission.AUDIT_READ)
  audit(@Param('id', ParseUUIDPipe) id: string) {
    return this.detail.audit(id);
  }

  // `invite` va antes que `:id` por claridad; no colisionan (POST vs PATCH/DELETE).
  @Post('invite')
  @Roles(Permission.USER_INVITE)
  invite(@Body() dto: InviteMemberDto) {
    return this.users.invite(dto);
  }

  @Post(':id/invite/resend')
  @HttpCode(HttpStatus.OK)
  @Roles(Permission.USER_INVITE)
  resendInvitation(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.resendInvitation(id);
  }

  /** `:id` es el **userId**, no el id de `user_accounts`. */
  @Patch(':id')
  @Roles(Permission.USER_WRITE)
  updateMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.users.updateMember(id, dto);
  }

  /** Cancela una invitación. Sólo pendientes (S2-D5); a un miembro activo se lo desactiva. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Permission.USER_WRITE)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.users.remove(id);
  }
}
