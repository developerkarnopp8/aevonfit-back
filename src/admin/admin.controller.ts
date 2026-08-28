import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CreateCoachDto, ToggleCoachAiDto } from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('coaches')
  @ApiOperation({ summary: 'Lista todos os coaches' })
  listCoaches() {
    return this.service.listCoaches();
  }

  @Post('coaches')
  @ApiOperation({ summary: 'Cria conta de coach nova, com senha forte gerada na hora' })
  createCoach(@Body() dto: CreateCoachDto) {
    return this.service.createCoach(dto);
  }

  @Post('coaches/:id/reset-password')
  @ApiOperation({ summary: 'Gera senha nova pro coach' })
  resetPassword(@Param('id') id: string) {
    return this.service.resetCoachPassword(id);
  }

  @Patch('coaches/:id')
  @ApiOperation({ summary: 'Liga/desliga a importação de PDF via IA pro coach' })
  toggleAi(@Param('id') id: string, @Body() dto: ToggleCoachAiDto) {
    return this.service.toggleCoachAi(id, dto.aiImportEnabled);
  }
}
