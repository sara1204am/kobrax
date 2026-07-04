import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/notification.dto';

/** Notificaciones del usuario autenticado (scope `own`: solo ve/gestiona las suyas). */
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(query);
  }

  @Post('read-all')
  @HttpCode(204)
  markAll() {
    return this.notifications.markAllRead();
  }

  @Post(':id/read')
  @HttpCode(204)
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }
}
