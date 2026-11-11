import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { Authenticated } from '../auth/decorators/authz.decorator';

/** Notificaciones del usuario autenticado (scope `own`: solo ve/gestiona las suyas). */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Authenticated()
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(query);
  }

  @Post('read-all')
  @Authenticated()
  @HttpCode(204)
  markAll() {
    return this.notifications.markAllRead();
  }

  @Post(':id/read')
  @Authenticated()
  @HttpCode(204)
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }
}
