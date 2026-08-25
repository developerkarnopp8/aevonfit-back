import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkoutSkipsService } from './workout-skips.service';
import { CreateWorkoutSkipDto } from './dto/create-workout-skip.dto';

@ApiTags('workout-skips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workout-skips')
export class WorkoutSkipsController {
  constructor(private readonly workoutSkipsService: WorkoutSkipsService) {}

  @Post()
  @ApiOperation({ summary: 'Registra que o atleta pulou um exercício ou sessão, com justificativa' })
  create(@Body() dto: CreateWorkoutSkipDto, @Request() req: any) {
    return this.workoutSkipsService.create(dto, req.user);
  }

  @Get('pending-count')
  @ApiOperation({ summary: 'Contagem de pulos pendentes por aluno (coach)' })
  getPendingCount(@Request() req: any) {
    return this.workoutSkipsService.getPendingCountByStudent(req.user.id);
  }
}
