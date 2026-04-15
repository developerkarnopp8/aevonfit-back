import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';

@Injectable()
export class WorkoutLogsService {
  constructor(private prisma: PrismaService) {}

  async logExercise(athleteId: string, dto: CreateWorkoutLogDto) {
    return this.prisma.workoutLog.create({
      data: {
        exerciseId: dto.exerciseId,
        athleteId,
        setsCompleted: dto.setsCompleted,
        notes: dto.notes,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date(),
      },
      include: {
        exercise: { select: { id: true, name: true, sessionId: true } },
      },
    });
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
