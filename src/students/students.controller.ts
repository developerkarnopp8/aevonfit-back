import {
  Controller, Get, Post, Patch, Body, Param, Request, UseGuards, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/create-student.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Retorna o perfil de aluno do usuário autenticado (atleta)' })
  getMyProfile(@Request() req: any) {
    return this.studentsService.findByUserId(req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Lista alunos (coach vê seus alunos)' })
  @ApiQuery({ name: 'coachId', required: false })
  findAll(@Query('coachId') coachId?: string) {
    return this.studentsService.findAll(coachId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca aluno por ID' })
  findOne(@Param('id') id: string) {
    return this.studentsService.findOne(id);
  }

  @Get(':id/plan')
  @ApiOperation({ summary: 'Retorna o plano ativo do aluno com estrutura completa' })
  getCurrentPlan(@Param('id') id: string) {
    return this.studentsService.getCurrentPlan(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria aluno vinculado a um coach' })
  create(@Request() req: any, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza dados do aluno' })
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.studentsService.update(id, dto);
  }
}
