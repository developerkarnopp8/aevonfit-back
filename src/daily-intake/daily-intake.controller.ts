import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DailyIntakeService } from './daily-intake.service';
import { LogHydrationDto, LogCaloriesDto } from './dto/daily-intake.dto';

@ApiTags('daily-intake')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('daily-intake')
export class DailyIntakeController {
  constructor(private readonly service: DailyIntakeService) {}

  @Roles('athlete')
  @Post('hydration')
  @ApiOperation({ summary: 'Registra ingestão de água (ml) do atleta logado' })
  logHydration(@Body() dto: LogHydrationDto, @Request() req: any) {
    return this.service.logHydration(req.user.id, dto.amountMl);
  }

  @Roles('athlete')
  @Post('calories')
  @ApiOperation({ summary: 'Registra calorias (kcal) do atleta logado' })
  logCalories(@Body() dto: LogCaloriesDto, @Request() req: any) {
    return this.service.logCalories(req.user.id, dto.kcal);
  }

  @Roles('athlete')
  @Get('today')
  @ApiOperation({ summary: 'Soma de hidratação/calorias registradas hoje pelo atleta logado' })
  getToday(@Request() req: any) {
    return this.service.getTodayTotals(req.user.id);
  }

  @Roles('coach')
  @Get('student/:studentId/history')
  @ApiOperation({ summary: 'Histórico de hidratação/calorias por dia (14 dias) de um aluno — coach dono' })
  getStudentHistory(@Param('studentId') studentId: string, @Request() req: any) {
    return this.service.getHistoryForStudent(studentId, req.user);
  }
}
