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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('training-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('training-plans')
export class TrainingPlansController {
  constructor(private readonly service: TrainingPlansService) {}

  // ── Plans ────────────────────────────────────────────────────────────────

  @Get('student/:studentId')
  @ApiOperation({ summary: 'Lista todos os planos de um aluno (coach dono ou o próprio aluno)' })
  findByStudent(@Param('studentId') studentId: string, @Request() req: any) {
    return this.service.findByStudent(studentId, req.user);
  }

  @Roles('coach')
  @Get('coach/weekly-completion')
  @ApiOperation({ summary: '% real de conclusão por dia da semana, agregado entre todos os alunos do coach (dashboard)' })
  getWeeklyCompletion(@Request() req: any) {
    return this.service.getWeeklyCompletionByDayIndex(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retorna plano completo (semanas > dias > sessões > exercícios)' })
  findById(@Param('id') id: string, @Request() req: any) {
    return this.service.findById(id, req.user);
  }

  @Roles('coach')
  @Post()
  @ApiOperation({ summary: 'Cria novo plano de treino' })
  create(@Request() req: any, @Body() dto: CreatePlanDto) {
    return this.service.create(req.user.id, dto);
  }

  @Roles('coach')
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza título ou status de publicação do plano' })
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto, @Request() req: any) {
    return this.service.update(id, req.user.id, dto);
  }

  @Roles('coach')
  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publica o plano para o aluno' })
  publish(@Param('id') id: string, @Request() req: any) {
    return this.service.publish(id, req.user.id);
  }

  @Roles('coach')
  @Post(':id/initialize')
  @ApiOperation({ summary: 'Inicializa 4 semanas × 6 dias se o plano não tiver semanas' })
  initializeWeeks(@Param('id') id: string, @Request() req: any) {
    return this.service.initializeWeeks(id, req.user.id);
  }

  @Roles('coach')
  @Delete(':id')
  @ApiOperation({ summary: 'Remove o plano' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(id, req.user.id);
  }

  // ── Weeks ────────────────────────────────────────────────────────────────

  @Roles('coach')
  @Post(':planId/weeks')
  @ApiOperation({ summary: 'Adiciona semana ao plano' })
  addWeek(@Param('planId') planId: string, @Body() dto: CreateWeekDto, @Request() req: any) {
    return this.service.addWeek(planId, req.user.id, dto);
  }

  @Roles('coach')
  @Delete('weeks/:weekId')
  @ApiOperation({ summary: 'Remove semana' })
  removeWeek(@Param('weekId') weekId: string, @Request() req: any) {
    return this.service.removeWeek(weekId, req.user.id);
  }

  // ── Days ─────────────────────────────────────────────────────────────────

  @Roles('coach')
  @Post('weeks/:weekId/days')
  @ApiOperation({ summary: 'Adiciona dia de treino à semana' })
  addDay(@Param('weekId') weekId: string, @Body() dto: CreateDayDto, @Request() req: any) {
    return this.service.addDay(weekId, req.user.id, dto);
  }

  @Roles('coach')
  @Delete('days/:dayId')
  @ApiOperation({ summary: 'Remove dia de treino' })
  removeDay(@Param('dayId') dayId: string, @Request() req: any) {
    return this.service.removeDay(dayId, req.user.id);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  @Roles('coach')
  @Post('days/:dayId/sessions')
  @ApiOperation({ summary: 'Adiciona sessão ao dia' })
  addSession(@Param('dayId') dayId: string, @Body() dto: CreateSessionDto, @Request() req: any) {
    return this.service.addSession(dayId, req.user.id, dto);
  }

  @Roles('coach')
  @Delete('sessions/:sessionId')
  @ApiOperation({ summary: 'Remove sessão' })
  removeSession(@Param('sessionId') sessionId: string, @Request() req: any) {
    return this.service.removeSession(sessionId, req.user.id);
  }

  // ── Exercises ────────────────────────────────────────────────────────────

  @Roles('coach')
  @Post('sessions/:sessionId/exercises')
  @ApiOperation({ summary: 'Adiciona exercício à sessão' })
  addExercise(@Param('sessionId') sessionId: string, @Body() dto: CreateExerciseDto, @Request() req: any) {
    return this.service.addExercise(sessionId, req.user.id, dto);
  }

  @Roles('coach')
  @Patch('exercises/:exerciseId')
  @ApiOperation({ summary: 'Atualiza exercício' })
  updateExercise(@Param('exerciseId') exerciseId: string, @Body() dto: UpdateExerciseDto, @Request() req: any) {
    return this.service.updateExercise(exerciseId, req.user.id, dto);
  }

  @Roles('coach')
  @Delete('exercises/:exerciseId')
  @ApiOperation({ summary: 'Remove exercício' })
  removeExercise(@Param('exerciseId') exerciseId: string, @Request() req: any) {
    return this.service.removeExercise(exerciseId, req.user.id);
  }
}
