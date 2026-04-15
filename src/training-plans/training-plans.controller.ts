import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Request, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TrainingPlansService } from './training-plans.service';
import {
  CreatePlanDto, UpdatePlanDto, CreateWeekDto, CreateDayDto,
  CreateSessionDto, CreateExerciseDto, UpdateExerciseDto,
} from './dto/training-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('training-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('training-plans')
export class TrainingPlansController {
  constructor(private readonly service: TrainingPlansService) {}

  // ── Plans ────────────────────────────────────────────────────────────────

  @Get('student/:studentId')
  @ApiOperation({ summary: 'Lista todos os planos de um aluno' })
  findByStudent(@Param('studentId') studentId: string) {
    return this.service.findByStudent(studentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retorna plano completo (semanas > dias > sessões > exercícios)' })
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria novo plano de treino' })
  create(@Request() req: any, @Body() dto: CreatePlanDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza título ou status de publicação do plano' })
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publica o plano para o aluno' })
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Post(':id/initialize')
  @ApiOperation({ summary: 'Inicializa 4 semanas × 6 dias se o plano não tiver semanas' })
  initializeWeeks(@Param('id') id: string) {
    return this.service.initializeWeeks(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove o plano' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // ── Weeks ────────────────────────────────────────────────────────────────

  @Post(':planId/weeks')
  @ApiOperation({ summary: 'Adiciona semana ao plano' })
  addWeek(@Param('planId') planId: string, @Body() dto: CreateWeekDto) {
    return this.service.addWeek(planId, dto);
  }

  @Delete('weeks/:weekId')
  @ApiOperation({ summary: 'Remove semana' })
  removeWeek(@Param('weekId') weekId: string) {
    return this.service.removeWeek(weekId);
  }

  // ── Days ─────────────────────────────────────────────────────────────────

  @Post('weeks/:weekId/days')
  @ApiOperation({ summary: 'Adiciona dia de treino à semana' })
  addDay(@Param('weekId') weekId: string, @Body() dto: CreateDayDto) {
    return this.service.addDay(weekId, dto);
  }

  @Delete('days/:dayId')
  @ApiOperation({ summary: 'Remove dia de treino' })
  removeDay(@Param('dayId') dayId: string) {
    return this.service.removeDay(dayId);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  @Post('days/:dayId/sessions')
  @ApiOperation({ summary: 'Adiciona sessão ao dia' })
  addSession(@Param('dayId') dayId: string, @Body() dto: CreateSessionDto) {
    return this.service.addSession(dayId, dto);
  }

  @Delete('sessions/:sessionId')
  @ApiOperation({ summary: 'Remove sessão' })
  removeSession(@Param('sessionId') sessionId: string) {
    return this.service.removeSession(sessionId);
  }

  // ── Exercises ────────────────────────────────────────────────────────────

  @Post('sessions/:sessionId/exercises')
  @ApiOperation({ summary: 'Adiciona exercício à sessão' })
  addExercise(@Param('sessionId') sessionId: string, @Body() dto: CreateExerciseDto) {
    return this.service.addExercise(sessionId, dto);
  }

  @Patch('exercises/:exerciseId')
  @ApiOperation({ summary: 'Atualiza exercício' })
  updateExercise(@Param('exerciseId') exerciseId: string, @Body() dto: UpdateExerciseDto) {
    return this.service.updateExercise(exerciseId, dto);
  }

  @Delete('exercises/:exerciseId')
  @ApiOperation({ summary: 'Remove exercício' })
  removeExercise(@Param('exerciseId') exerciseId: string) {
    return this.service.removeExercise(exerciseId);
  }
}
