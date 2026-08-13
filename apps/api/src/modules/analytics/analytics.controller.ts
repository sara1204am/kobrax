import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto, TrendQueryDto } from './dto/analytics.dto';

/**
 * Las seis lecturas del dashboard (W8).
 *
 * Todas piden `report:read`, que **existía como permiso desde el principio y no lo usaba ningún
 * endpoint**: lo tienen MANAGER, SUPERVISOR, AUDITOR y VIEWER. Un cobrador no ve el tablero de la
 * gerencia, y eso es a propósito.
 */
@Controller('analytics')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Permission.REPORT_READ)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  summary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.summary(query);
  }

  @Get('portfolio-aging')
  aging(@Query() query: AnalyticsQueryDto) {
    return this.analytics.portfolioAging(query);
  }

  @Get('collector-performance')
  collectors(@Query() query: AnalyticsQueryDto) {
    return this.analytics.collectorPerformance(query);
  }

  @Get('agenda-summary')
  agenda(@Query() query: AnalyticsQueryDto) {
    return this.analytics.agendaSummary(query);
  }

  @Get('visit-map')
  visits(@Query() query: AnalyticsQueryDto) {
    return this.analytics.visitMap(query);
  }

  @Get('collection-trend')
  trend(@Query() query: TrendQueryDto) {
    return this.analytics.collectionTrend(query);
  }
}
