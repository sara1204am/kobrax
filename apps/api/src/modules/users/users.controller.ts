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
  UseGuards,
} from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';
import { InviteMemberDto, UpdateMemberDto, UpdateProfileDto } from './dto/user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

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
