import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WorkoutSkipsService } from './workout-skips.service';
import { CreateWorkoutSkipDto } from './dto/create-workout-skip.dto';

@ApiTags('workout-skips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('workout-skips')
export class WorkoutSkipsController {
  constructor(private readonly workoutSkipsService: WorkoutSkipsService) {}

  @Post()
  @Roles('athlete')
  @ApiOperation({ summary: 'Registra que o atleta pulou um exercício ou sessão, com justificativa' })
  create(@Body() dto: CreateWorkoutSkipDto, @Request() req: any) {
    return this.workoutSkipsService.create(dto, req.user);
  }

  @Get('pending-count')
  @Roles('coach')
  @ApiOperation({ summary: 'Contagem de pulos pendentes por aluno (coach)' })
  getPendingCount(@Request() req: any) {
    return this.workoutSkipsService.getPendingCountByStudent(req.user.id);
  }
}
