import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type AuthUser = { id: string; role: string };

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string, user: AuthUser) {
    // 1ª consulta: só o necessário pra checar posse (coach dono ou o próprio atleta),
    // sem trazer nenhum dado sensível antes de autorizar (histórico de IDOR no projeto).
    const context = await this.prisma.session.findUnique({
      where: { id },
      select: {
        day: {
          select: {
            week: {
              select: {
                plan: {
                  select: { coachId: true, student: { select: { userId: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!context) throw new NotFoundException('Sessão não encontrada');

    const plan = context.day.week.plan;
    const isOwningCoach = user.role === 'coach' && plan.coachId === user.id;
    const isSelf = user.role === 'athlete' && plan.student.userId === user.id;
    if (!isOwningCoach && !isSelf) {
      throw new ForbiddenException('Você não tem acesso a esta sessão.');
    }

    // athleteId = dono do plano (não necessariamente quem está pedindo — o coach também
    // pode ver a sessão). workoutSkips é filtrado por esse athleteId nos dois níveis,
    // igual ao fullPlanInclude do TrainingPlansService, pra não vazar skip de outro aluno.
    const athleteId = plan.student.userId;

    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        workoutSkips: { where: { athleteId }, orderBy: { createdAt: 'desc' }, take: 1 },
        exercises: {
          orderBy: { order: 'asc' },
          include: {
            workoutLogs: {
              where: { athleteId: user.id },
              orderBy: { completedAt: 'desc' },
              take: 1,
            },
            workoutSkips: { where: { athleteId }, orderBy: { createdAt: 'desc' }, take: 1 },
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
