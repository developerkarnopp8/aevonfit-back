import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string, athleteId?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: athleteId
            ? {
                workoutLogs: {
                  where: { athleteId },
                  orderBy: { completedAt: 'desc' },
                  take: 1,
                },
              }
            : undefined,
        },
        day: {
          include: {
            week: {
              include: { plan: { select: { id: true, title: true } } },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
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
