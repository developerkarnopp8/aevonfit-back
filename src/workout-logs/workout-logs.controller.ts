import { Controller, Get, Post, Body, Param, Request, UseGuards, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WorkoutLogsService } from './workout-logs.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('workout-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workout-logs')
export class WorkoutLogsController {
  constructor(private readonly workoutLogsService: WorkoutLogsService) {}

  @Post()
  @ApiOperation({ summary: 'Registra conclusão de um exercício pelo atleta' })
  logExercise(@Request() req: any, @Body() dto: CreateWorkoutLogDto) {
    return this.workoutLogsService.logExercise(req.user.id, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Histórico de treinos do atleta autenticado' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getHistory(@Request() req: any, @Query('limit') limit?: number) {
    return this.workoutLogsService.getHistory(req.user.id, limit ? Number(limit) : 50);
  }

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Logs do atleta para uma sessão específica' })
  getSessionLogs(@Param('sessionId') sessionId: string, @Request() req: any) {
    return this.workoutLogsService.getSessionLogs(sessionId, req.user.id);
  }

  @Get('exercise/:exerciseId')
  @ApiOperation({ summary: 'Histórico do atleta para um exercício específico' })
  getExerciseHistory(@Param('exerciseId') exerciseId: string, @Request() req: any) {
    return this.workoutLogsService.getExerciseHistory(exerciseId, req.user.id);
  }
}
