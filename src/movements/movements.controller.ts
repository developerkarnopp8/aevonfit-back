import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';

@ApiTags('movements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('movements')
export class MovementsController {
  constructor(private readonly service: MovementsService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de movimentos disponível (globais + customizados do coach)' })
  findAvailable(@Request() req: any) {
    return this.service.findAvailable(req.user);
  }

  @Roles('coach')
  @Post()
  @ApiOperation({ summary: 'Cadastra movimento customizado, visível só pros próprios alunos' })
  create(@Body() dto: CreateMovementDto, @Request() req: any) {
    return this.service.create(req.user.id, dto);
  }
}
