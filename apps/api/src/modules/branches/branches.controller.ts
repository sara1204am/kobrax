import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchesService } from './branches.service';
import { AssignMembersDto, CreateBranchDto, CreateBranchTypeDto, MoveBranchDto, UpdateBranchDto, UpdateBranchTypeDto } from './dto/branch.dto';

/**
 * Oficinas de la cuenta, en árbol (F13). Leer: `office:read`. Escribir: `office:write` (ya no `account:write` ni `user:read`:
 * la administración de oficinas es un permiso propio que F14 podrá delegar por rol).
 */
@Controller('branches')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** Lista plana del árbol (con `parentId`, `path`, `depth`, `fullName`…). */
  @Get()
  @Roles(Permission.OFFICE_READ)
  list() {
    return this.branches.list();
  }

  @Get(':id')
  @Roles(Permission.OFFICE_READ)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.detail(id);
  }

  @Post()
  @Roles(Permission.OFFICE_WRITE)
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Patch(':id')
  @Roles(Permission.OFFICE_WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  /** Cambia la oficina de lugar en el árbol (con su subárbol). */
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @Roles(Permission.OFFICE_WRITE)
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveBranchDto) {
    return this.branches.move(id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(Permission.OFFICE_WRITE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.deactivate(id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(Permission.OFFICE_WRITE)
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.restore(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Permission.OFFICE_WRITE)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.branches.remove(id);
  }

  /** Asigna personas a la oficina (por defecto las MUEVE si estaban en otra). */
  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  @Roles(Permission.OFFICE_WRITE)
  assignMembers(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignMembersDto) {
    return this.branches.assignMembers(id, dto);
  }

  /** Quita a la persona de la oficina. */
  @Delete(':id/members/:userId')
  @Roles(Permission.OFFICE_WRITE)
  unassignMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.branches.unassignMember(id, userId);
  }
}

/** Catálogo de tipos de oficina por cuenta (Central, Regional, Agencia… editable: R1). */
@Controller('branch-types')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class BranchTypesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Roles(Permission.OFFICE_READ)
  list() {
    return this.branches.listTypes();
  }

  @Post()
  @Roles(Permission.OFFICE_WRITE)
  create(@Body() dto: CreateBranchTypeDto) {
    return this.branches.createType(dto);
  }

  @Patch(':id')
  @Roles(Permission.OFFICE_WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchTypeDto) {
    return this.branches.updateType(id, dto);
  }
}
