import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePlanDto, UpdatePlanDto,
  CreateWeekDto, CreateDayDto, CreateSessionDto,
  CreateExerciseDto, UpdateExerciseDto,
} from './dto/training-plan.dto';

const fullPlanInclude = {
  weeks: {
    orderBy: { weekNumber: 'asc' as const },
    include: {
      days: {
        orderBy: { dayIndex: 'asc' as const },
        include: {
          sessions: {
            orderBy: { order: 'asc' as const },
            include: {
              exercises: { orderBy: { order: 'asc' as const } },
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class TrainingPlansService {
  constructor(private prisma: PrismaService) {}

  // ── Plans ────────────────────────────────────────────────────────────────

  async findByStudent(studentId: string) {
    return this.prisma.trainingPlan.findMany({
      where: { studentId },
      include: fullPlanInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id },
      include: fullPlanInclude,
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    return plan;
  }

  async create(coachId: string, dto: CreatePlanDto) {
    const WEEKS = 4;
    const DAYS = [
      { dayOfWeek: 'Segunda', dayIndex: 1 },
      { dayOfWeek: 'Terça',   dayIndex: 2 },
      { dayOfWeek: 'Quarta',  dayIndex: 3 },
      { dayOfWeek: 'Quinta',  dayIndex: 4 },
      { dayOfWeek: 'Sexta',   dayIndex: 5 },
      { dayOfWeek: 'Sábado',  dayIndex: 6 },
    ];

    return this.prisma.$transaction(async tx => {
      const plan = await tx.trainingPlan.create({
        data: { ...dto, coachId },
      });

      for (let w = 1; w <= WEEKS; w++) {
        const week = await tx.week.create({
          data: { planId: plan.id, weekNumber: w },
        });
        await tx.trainingDay.createMany({
          data: DAYS.map(d => ({ weekId: week.id, ...d })),
        });
      }

      return tx.trainingPlan.findUnique({
        where: { id: plan.id },
        include: fullPlanInclude,
      });
    });
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findById(id);
    return this.prisma.trainingPlan.update({ where: { id }, data: dto });
  }

  async publish(id: string) {
    await this.findById(id);
    return this.prisma.trainingPlan.update({
      where: { id },
      data: { published: true },
    });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.trainingPlan.delete({ where: { id } });
  }

  // ── Weeks ────────────────────────────────────────────────────────────────

  /** Garante que o plano tenha 4 semanas × 6 dias. Idempotente. */
  async initializeWeeks(planId: string) {
    const plan = await this.findById(planId);
    if (plan.weeks.length > 0) return plan; // já inicializado

    const DAYS = [
      { dayOfWeek: 'Segunda', dayIndex: 1 },
      { dayOfWeek: 'Terça',   dayIndex: 2 },
      { dayOfWeek: 'Quarta',  dayIndex: 3 },
      { dayOfWeek: 'Quinta',  dayIndex: 4 },
      { dayOfWeek: 'Sexta',   dayIndex: 5 },
      { dayOfWeek: 'Sábado',  dayIndex: 6 },
    ];

    await this.prisma.$transaction(async tx => {
      for (let w = 1; w <= 4; w++) {
        const week = await tx.week.create({ data: { planId, weekNumber: w } });
        await tx.trainingDay.createMany({ data: DAYS.map(d => ({ weekId: week.id, ...d })) });
      }
    });

    return this.findById(planId);
  }

  async addWeek(planId: string, dto: CreateWeekDto) {
    await this.findById(planId);
    return this.prisma.week.create({ data: { planId, ...dto } });
  }

  async removeWeek(weekId: string) {
    return this.prisma.week.delete({ where: { id: weekId } });
  }

  // ── Days ─────────────────────────────────────────────────────────────────

  async addDay(weekId: string, dto: CreateDayDto) {
    return this.prisma.trainingDay.create({ data: { weekId, ...dto } });
  }

  async removeDay(dayId: string) {
    return this.prisma.trainingDay.delete({ where: { id: dayId } });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  async addSession(dayId: string, dto: CreateSessionDto) {
    return this.prisma.session.create({
      data: { dayId, ...dto },
      include: { exercises: { orderBy: { order: 'asc' } } },
    });
  }

  async removeSession(sessionId: string) {
    return this.prisma.session.delete({ where: { id: sessionId } });
  }

  // ── Exercises ────────────────────────────────────────────────────────────

  async addExercise(sessionId: string, dto: CreateExerciseDto) {
    return this.prisma.exercise.create({
      data: { sessionId, ...dto } as any,
    });
  }

  async updateExercise(exerciseId: string, dto: UpdateExerciseDto) {
    return this.prisma.exercise.update({
      where: { id: exerciseId },
      data: dto as any,
    });
  }

  async removeExercise(exerciseId: string) {
    return this.prisma.exercise.delete({ where: { id: exerciseId } });
  }
}
