import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Request, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExerciseLibraryService } from './exercise-library.service';
import { CreateExerciseLibraryDto, UpdateExerciseLibraryDto } from './dto/exercise-library.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('exercise-library')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('exercise-library')
export class ExerciseLibraryController {
  constructor(private readonly service: ExerciseLibraryService) {}

  @Get()
  @ApiOperation({ summary: 'Lista exercícios da biblioteca do coach' })
  findAll(@Request() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Adiciona exercício à biblioteca' })
  create(@Request() req: any, @Body() dto: CreateExerciseLibraryDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza exercício da biblioteca' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateExerciseLibraryDto) {
    return this.service.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove exercício da biblioteca' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(id, req.user.id);
  }
}
