import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Permission, ResponseDto } from '@kobrax/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsService } from './payments.service';
import { LateInterestService } from './late-interest.service';
import { CreateLateWaiverDto } from './dto/late-waiver.dto';
import { ConfirmPaymentRequestDto, CreatePaymentDto, CreatePaymentRequestDto, ListPaymentRequestsQueryDto, ListPaymentsQueryDto } from './dto/payment.dto';

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly lateInterest: LateInterestService,
  ) {}

  // ── Interés moratorio (F17 · F3-d) ───────────────────────────────────────────
  /** Lo devengado, cobrado, exonerado y pendiente de un crédito; `null` si no devenga. */
  @Get('credits/:creditId/late-interest')
  @Roles(Permission.PAYMENT_READ)
  lateOf(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.lateInterest.current(creditId).then((data) => ResponseDto.ok(data));
  }

  /** Perdonar mora de una cuota. Permiso aparte de `payment:write`; motivo obligatorio y auditado. */
  @Post('credits/:creditId/late-interest/waivers')
  @Roles(Permission.PAYMENT_WAIVE_LATE)
  waiveLate(@Param('creditId', ParseUUIDPipe) creditId: string, @Body() dto: CreateLateWaiverDto) {
    return this.lateInterest.waive(creditId, dto).then((data) => ResponseDto.ok(data));
  }

  // ── Pagos ────────────────────────────────────────────────────────────────────
  @Post('payments')
  @Roles(Permission.PAYMENT_WRITE)
  register(@Body() dto: CreatePaymentDto, @Headers('idempotency-key') key?: string, @Headers('x-app-version') appVersion?: string) {
    // La app móvil manda su versión en TODA llamada; el panel no. Sirve de pista cuando el cuerpo no dice desde dónde viene.
    return this.payments.register(dto, key, appVersion ? 'MOBILE' : undefined);
  }

  @Get('payments')
  @Roles(Permission.PAYMENT_READ)
  list(@Query() query: ListPaymentsQueryDto) {
    return this.payments.list(query);
  }

  /** Historial de UN crédito con la imputación de cada pago. Va antes de `payments/:id` por claridad: son rutas distintas. */
  @Get('credits/:creditId/payments')
  @Roles(Permission.PAYMENT_READ)
  forCredit(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.payments.forCredit(creditId);
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

  @Get('payment-requests')
  @Roles(Permission.PAYMENT_READ)
  listRequests(@Query() query: ListPaymentRequestsQueryDto) {
    return this.payments.listRequests(query);
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
