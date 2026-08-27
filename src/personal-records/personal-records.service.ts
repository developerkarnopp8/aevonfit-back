import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MovementsService } from '../movements/movements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class PersonalRecordsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private movementsService: MovementsService,
    private notificationsService: NotificationsService,
  ) {}

  async create(athleteId: string, dto: CreatePersonalRecordDto) {
    if (dto.loadKg == null && dto.reps == null) {
      throw new BadRequestException('Informe carga (kg) e/ou repetições.');
    }
    const isAvailable = await this.movementsService.isAvailableForUser({ id: athleteId, role: 'athlete' }, dto.movementId);
    if (!isAvailable) {
      throw new NotFoundException('Movimento não encontrado no seu catálogo.');
    }

    const existing = await this.prisma.personalRecord.findMany({
      where: { athleteId, movementId: dto.movementId },
    });
    const isNewLoadPr = dto.loadKg != null
      && !existing.some(r => r.loadKg != null && r.loadKg >= dto.loadKg!);
    const isNewRepsPr = dto.reps != null
      && !existing.some(r => r.reps != null && r.reps >= dto.reps!);

    const record = await this.prisma.personalRecord.create({
      data: {
        athleteId,
        movementId: dto.movementId,
        loadKg: dto.loadKg,
        reps: dto.reps,
        note: dto.note,
      },
      include: { movement: true },
    });

    if (isNewLoadPr || isNewRepsPr) {
      const student = await this.prisma.student.findFirst({
        where: { userId: athleteId },
        select: { id: true, coachId: true },
      });
      if (student) {
        const metric = isNewLoadPr && isNewRepsPr ? 'carga e repetições' : isNewLoadPr ? 'carga' : 'repetições';
        await this.notificationsService.create(
          student.coachId,
          'new_pr',
          'Novo recorde pessoal!',
          `Novo recorde de ${metric} em ${record.movement.name}.`,
          `/coach/plan-builder/${student.id}`,
        );
      }
    }

    return record;
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
