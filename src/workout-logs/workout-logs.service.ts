import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { StudentsService } from '../students/students.service';

type AuthUser = { id: string; role: string };

@Injectable()
export class WorkoutLogsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
  ) {}

  /** Só o atleta dono do plano em que o exercício está (via StudentsService) pode registrar o log. */
  async logExercise(user: AuthUser, dto: CreateWorkoutLogDto) {
    const { studentId } = await this.loadExerciseContext(dto.exerciseId);
    await this.studentsService.findOne(studentId, user);

    return this.prisma.workoutLog.create({
      data: {
        exerciseId: dto.exerciseId,
        athleteId: user.id,
        setsCompleted: dto.setsCompleted,
        durationSeconds: dto.durationSeconds ?? null,
        notes: dto.notes,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date(),
      },
      include: {
        exercise: { select: { id: true, name: true, sessionId: true } },
      },
    });
  }

  private async loadExerciseContext(exerciseId: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { session: { include: { day: { include: { week: { include: { plan: true } } } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercício não encontrado');
    return { studentId: exercise.session.day.week.plan.studentId };
  }

  async getHistory(athleteId: string, limit = 50) {
    return this.prisma.workoutLog.findMany({
      where: { athleteId },
      orderBy: { completedAt: 'desc' },
      take: limit,
      include: {
        exercise: {
          select: {
            id: true,
            name: true,
            session: {
              select: {
                id: true,
                name: true,
                type: true,
                day: {
                  select: {
                    dayOfWeek: true,
                    week: { select: { weekNumber: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /** Histórico de treino de um aluno específico — só o coach dono (ou o próprio atleta). */
  async getStudentHistory(studentId: string, user: AuthUser, limit = 50) {
    const student = await this.studentsService.findOne(studentId, user);
    return this.getHistory(student.userId, limit);
  }

  async getSessionLogs(sessionId: string, athleteId: string) {
    return this.prisma.workoutLog.findMany({
      where: {
        athleteId,
        exercise: { sessionId },
      },
      orderBy: { completedAt: 'desc' },
      include: {
        exercise: { select: { id: true, name: true } },
      },
    });
  }

  async getExerciseHistory(exerciseId: string, athleteId: string) {
    return this.prisma.workoutLog.findMany({
      where: { exerciseId, athleteId },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });
  }
}
