import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class PersonalRecordsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
  ) {}

  async create(athleteId: string, dto: CreatePersonalRecordDto) {
    if (dto.loadKg == null && dto.reps == null) {
      throw new BadRequestException('Informe carga (kg) e/ou repetições.');
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
