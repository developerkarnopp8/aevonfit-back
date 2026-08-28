import { Controller, Post, Body, Request, UseGuards } from '@nestjs/common';
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
}
