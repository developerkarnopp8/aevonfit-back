import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

type AuthUser = { id: string; role: string };

const HISTORY_DAYS = 14;

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

@Injectable()
export class DailyIntakeService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
  ) {}

  async logHydration(athleteId: string, amountMl: number) {
    return this.prisma.hydrationLog.create({ data: { athleteId, amountMl } });
  }

  async logCalories(athleteId: string, kcal: number) {
    return this.prisma.calorieLog.create({ data: { athleteId, kcal } });
  }

  async getTodayTotals(athleteId: string): Promise<{ hydrationMl: number; calories: number }> {
    const now = new Date();
    const where = { athleteId, loggedAt: { gte: startOfDay(now), lte: endOfDay(now) } };

    const [hydrationLogs, calorieLogs] = await Promise.all([
      this.prisma.hydrationLog.findMany({ where, select: { amountMl: true } }),
      this.prisma.calorieLog.findMany({ where, select: { kcal: true } }),
    ]);

    return {
      hydrationMl: hydrationLogs.reduce((sum, l) => sum + l.amountMl, 0),
      calories: calorieLogs.reduce((sum, l) => sum + l.kcal, 0),
    };
  }

  /** Histórico agregado por dia (últimos 14 dias) — só o coach dono do aluno ou o próprio atleta. */
  async getHistoryForStudent(studentId: string, user: AuthUser, days = HISTORY_DAYS) {
    const student = await this.studentsService.findOne(studentId, user);

    const since = startOfDay(new Date());
    since.setDate(since.getDate() - (days - 1));

    const where = { athleteId: student.userId, loggedAt: { gte: since } };
    const [hydrationLogs, calorieLogs] = await Promise.all([
      this.prisma.hydrationLog.findMany({ where, select: { amountMl: true, loggedAt: true } }),
      this.prisma.calorieLog.findMany({ where, select: { kcal: true, loggedAt: true } }),
    ]);

    const byDate = new Map<string, { hydrationMl: number; calories: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      byDate.set(d.toISOString().slice(0, 10), { hydrationMl: 0, calories: 0 });
    }

    for (const log of hydrationLogs) {
      const bucket = byDate.get(log.loggedAt.toISOString().slice(0, 10));
      if (bucket) bucket.hydrationMl += log.amountMl;
    }
    for (const log of calorieLogs) {
      const bucket = byDate.get(log.loggedAt.toISOString().slice(0, 10));
      if (bucket) bucket.calories += log.kcal;
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, totals]) => ({ date, ...totals }));
  }
}
