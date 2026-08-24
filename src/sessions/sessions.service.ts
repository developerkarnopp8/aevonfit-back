import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type AuthUser = { id: string; role: string };

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string, user: AuthUser) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: {
            workoutLogs: {
              where: { athleteId: user.id },
              orderBy: { completedAt: 'desc' },
              take: 1,
            },
          },
        },
        day: {
          include: {
            week: {
              include: {
                plan: {
                  select: {
                    id: true,
                    title: true,
                    coachId: true,
                    student: { select: { userId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const plan = session.day.week.plan;
    const isOwningCoach = user.role === 'coach' && plan.coachId === user.id;
    const isSelf = user.role === 'athlete' && plan.student.userId === user.id;
    if (!isOwningCoach && !isSelf) {
      throw new ForbiddenException('Você não tem acesso a esta sessão.');
    }

    return session;
  }

  async findByDay(dayId: string) {
    return this.prisma.session.findMany({
      where: { dayId },
      orderBy: { order: 'asc' },
      include: {
        exercises: { orderBy: { order: 'asc' } },
      },
    });
  }
}
