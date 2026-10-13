import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { DevicesService } from './devices.service';

export class RegisterDeviceDto {
  /** Identidad estable de la instalación (la genera la app una vez). Renovar el token no cambia este valor. */
  @IsUUID() installationId!: string;

  /** Token de registro de FCM. Largo razonable: uno inventado o vacío no entra. */
  @IsString() @MinLength(20) @MaxLength(4096) token!: string;

  @IsOptional() @IsIn(['android']) platform?: 'android';
  @IsOptional() @IsString() @MaxLength(32) appVersion?: string;
  @IsOptional() @IsString() @MaxLength(80) deviceName?: string;
}

/**
 * Dispositivos de push del usuario autenticado (scope `own`, como la bandeja). Sin `@Roles`: cualquier sesión con
 * empresa puede registrar el teléfono; lo que se envía luego depende de los avisos que ya le corresponden.
 */
@Controller('notifications/devices')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(200)
  register(@Body() dto: RegisterDeviceDto) {
    return this.devices.register(dto);
  }

  @Get()
  list() {
    return this.devices.listMine();
  }

  @Delete(':installationId')
  @HttpCode(204)
  revoke(@Param('installationId', ParseUUIDPipe) installationId: string) {
    return this.devices.revoke(installationId);
  }
}
