import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsService } from './payments.service';
import { ConfirmPaymentRequestDto, CreatePaymentDto, CreatePaymentRequestDto, ListPaymentsQueryDto } from './dto/payment.dto';

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ── Pagos ────────────────────────────────────────────────────────────────────
  @Post('payments')
  @Roles(Permission.PAYMENT_WRITE)
  register(@Body() dto: CreatePaymentDto, @Headers('idempotency-key') key?: string) {
    return this.payments.register(dto, key);
  }

  @Get('payments')
  @Roles(Permission.PAYMENT_READ)
  list(@Query() query: ListPaymentsQueryDto) {
    return this.payments.list(query);
  }

  @Get('payments/:id')
  @Roles(Permission.PAYMENT_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(id);
  }

  // ── Solicitudes de pago (QR / link) ──────────────────────────────────────────
  @Post('payment-requests')
  @Roles(Permission.PAYMENT_WRITE)
  createRequest(@Body() dto: CreatePaymentRequestDto) {
    return this.payments.createRequest(dto);
  }

  @Get('payment-requests/:id')
  @Roles(Permission.PAYMENT_READ)
  getRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.getRequest(id);
  }

  @Post('payment-requests/:id/confirm')
  @Roles(Permission.PAYMENT_APPROVE)
  confirmRequest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmPaymentRequestDto) {
    return this.payments.confirmRequest(id, dto);
  }
}
