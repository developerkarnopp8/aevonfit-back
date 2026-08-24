import {
  Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/create-student.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Retorna o perfil de aluno do usuário autenticado (atleta)' })
  getMyProfile(@Request() req: any) {
    return this.studentsService.findByUserId(req.user.id);
  }

  @Roles('coach')
  @Get()
  @ApiOperation({ summary: 'Lista os alunos do coach autenticado' })
  findAll(@Request() req: any) {
    return this.studentsService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca aluno por ID (coach dono ou o próprio aluno)' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.studentsService.findOne(id, req.user);
  }

  @Get(':id/plan')
  @ApiOperation({ summary: 'Retorna o plano ativo do aluno com estrutura completa' })
  getCurrentPlan(@Param('id') id: string, @Request() req: any) {
    return this.studentsService.getCurrentPlan(id, req.user);
  }

  @Roles('coach')
  @Post()
  @ApiOperation({ summary: 'Cria aluno vinculado a um coach' })
  create(@Request() req: any, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(req.user.id, dto);
  }

  @Roles('coach')
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza dados do aluno (somente o coach dono)' })
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto, @Request() req: any) {
    return this.studentsService.update(id, req.user.id, dto);
  }

  @Roles('coach')
  @Delete(':id')
  @ApiOperation({ summary: 'Remove aluno e conta de usuário (somente o coach dono)' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.studentsService.remove(id, req.user.id);
  }
}
