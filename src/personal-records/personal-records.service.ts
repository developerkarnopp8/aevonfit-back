import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MovementsService } from '../movements/movements.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class PersonalRecordsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private movementsService: MovementsService,
  ) {}

  async create(athleteId: string, dto: CreatePersonalRecordDto) {
    if (dto.loadKg == null && dto.reps == null) {
      throw new BadRequestException('Informe carga (kg) e/ou repetições.');
    }
    const isAvailable = await this.movementsService.isAvailableForUser({ id: athleteId, role: 'athlete' }, dto.movementId);
    if (!isAvailable) {
      throw new NotFoundException('Movimento não encontrado no seu catálogo.');
    }
    return this.prisma.personalRecord.create({
      data: {
        athleteId,
        movementId: dto.movementId,
        loadKg: dto.loadKg,
        reps: dto.reps,
        note: dto.note,
      },
    });
  }

  async getMyHistory(athleteId: string) {
    return this.prisma.personalRecord.findMany({
      where: { athleteId },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  }

  /** Histórico completo de um aluno, pro gráfico do coach — só o coach dono. */
  async getHistoryForStudent(studentId: string, user: AuthUser) {
    const student = await this.studentsService.findOne(studentId, user);
    return this.prisma.personalRecord.findMany({
      where: { athleteId: student.userId },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  }
}
