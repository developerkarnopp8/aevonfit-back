import { Controller, Post, Get, Param, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WorkoutSessionsService } from './workout-sessions.service';
import { CheckoutWorkoutSessionDto } from './dto/checkout-workout-session.dto';

@ApiTags('workout-sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('workout-sessions')
export class WorkoutSessionsController {
  constructor(private readonly service: WorkoutSessionsService) {}

  @Roles('athlete')
  @Post()
  @ApiOperation({ summary: 'Checkout: grava a sessão executada (atleta logado)' })
  checkout(@Request() req: any, @Body() dto: CheckoutWorkoutSessionDto) {
    return this.service.checkout(req.user, dto);
  }

  @Roles('athlete')
  @Get('me')
  @ApiOperation({ summary: 'Histórico de sessões executadas do atleta logado' })
  listMine(@Request() req: any) {
    return this.service.listMine(req.user.id);
  }

  @Roles('coach')
  @Get('student/:studentId/summary')
  @ApiOperation({ summary: 'Resumo de tempo de execução de um aluno (coach dono)' })
  studentSummary(@Param('studentId') studentId: string, @Request() req: any) {
    return this.service.studentSummary(studentId, req.user);
  }
}
