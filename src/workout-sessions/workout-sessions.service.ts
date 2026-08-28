import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { CheckoutWorkoutSessionDto } from './dto/checkout-workout-session.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class WorkoutSessionsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
  ) {}

  /** Grava a sessão executada. Chamado no "Finalizar treino" do atleta. */
  async checkout(user: AuthUser, dto: CheckoutWorkoutSessionDto) {
    const started = new Date(dto.startedAt);
    const finished = new Date(dto.finishedAt);
    if (finished.getTime() < started.getTime()) {
      throw new BadRequestException('finishedAt não pode ser anterior a startedAt');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: dto.sessionId },
      include: {
        day: { include: { week: { include: { plan: { select: { studentId: true } } } } } },
        exercises: { select: { id: true } },
      },
    });
    if (!session) throw new BadRequestException('Sessão não encontrada');

    const studentId = session.day.week.plan.studentId;
    await this.studentsService.findOne(studentId, user); // ownership: 403 se não for dono/self

    const logs = await this.prisma.workoutLog.findMany({
      where: { athleteId: user.id, exercise: { sessionId: dto.sessionId } },
      select: { exerciseId: true, durationSeconds: true },
    });

    const activeSeconds = logs.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0);
    const loggedExerciseIds = new Set(logs.map(l => l.exerciseId));
    const allLogged =
      session.exercises.length > 0 &&
      session.exercises.every(e => loggedExerciseIds.has(e.id));

    const elapsedSeconds = Math.max(
      0,
      Math.round((finished.getTime() - started.getTime()) / 1000),
    );

    return this.prisma.workoutSession.create({
      data: {
        sessionId: dto.sessionId,
        athleteId: user.id,
        startedAt: started,
        finishedAt: finished,
        elapsedSeconds,
        activeSeconds,
        status: allLogged ? 'Completed' : 'Partial',
      },
      include: { session: { select: { name: true } } },
    });
  }

  /** Histórico de sessões executadas do atleta logado (mais recentes primeiro). */
  async listMine(athleteId: string) {
    const rows = await this.prisma.workoutSession.findMany({
      where: { athleteId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { session: { select: { name: true, type: true } } },
    });
    return rows.map(r => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionName: r.session.name,
      sessionType: r.session.type,
      startedAt: r.startedAt,
      elapsedSeconds: r.elapsedSeconds,
      activeSeconds: r.activeSeconds,
      status: r.status,
    }));
  }

  private mean(nums: number[]): number {
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
  }

  /** Resumo de tempo de execução de um aluno (coach dono). */
  async studentSummary(studentId: string, user: AuthUser) {
    const student = await this.studentsService.findOne(studentId, user);
    const athleteId = student.userId;

    const sessions = await this.prisma.workoutSession.findMany({
      where: { athleteId },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { elapsedSeconds: true, startedAt: true },
    });

    const durations = sessions.map(s => s.elapsedSeconds);
    let trend: { direction: 'faster' | 'slower' | 'equal' | 'new'; deltaSeconds: number } = {
      direction: 'new', deltaSeconds: 0,
    };
    if (durations.length >= 6) {
      const recent = this.mean(durations.slice(0, 3));
      const previous = this.mean(durations.slice(3, 6));
      const delta = recent - previous;
      trend = {
        direction: delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'equal',
        deltaSeconds: delta,
      };
    }

    const logs = await this.prisma.workoutLog.findMany({
      where: { athleteId, durationSeconds: { not: null } },
      select: { durationSeconds: true, exercise: { select: { name: true } } },
    });
    const byName = new Map<string, number[]>();
    for (const l of logs) {
      const arr = byName.get(l.exercise.name) ?? [];
      arr.push(l.durationSeconds as number);
      byName.set(l.exercise.name, arr);
    }
    const perExercise = Array.from(byName.entries())
      .map(([exerciseName, vals]) => ({ exerciseName, avgSeconds: this.mean(vals), samples: vals.length }))
      .sort((a, b) => b.samples - a.samples || a.exerciseName.localeCompare(b.exerciseName))
      .slice(0, 10);

    return {
      count: sessions.length,
      avgElapsedSeconds: this.mean(durations),
      trend,
      perExercise,
    };
  }

  /** Detalhe de tempo por exercício + última execução de uma sessão (coach dono). */
  async sessionDetail(studentId: string, sessionId: string, user: AuthUser) {
    const student = await this.studentsService.findOne(studentId, user);
    const athleteId = student.userId;

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: {
            workoutLogs: {
              where: { athleteId },
              orderBy: { completedAt: 'desc' },
              take: 1,
              select: { durationSeconds: true },
            },
          },
        },
      },
    });
    if (!session) throw new BadRequestException('Sessão não encontrada');

    const executions = await this.prisma.workoutSession.findMany({
      where: { sessionId, athleteId },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, elapsedSeconds: true, activeSeconds: true, status: true },
    });

    return {
      sessionId: session.id,
      sessionName: session.name,
      exercises: session.exercises.map(e => ({
        id: e.id,
        name: e.name,
        durationSeconds: e.workoutLogs[0]?.durationSeconds ?? null,
        completed: e.workoutLogs.length > 0,
      })),
      lastExecution: executions[0] ?? null,
      executionCount: executions.length,
    };
  }

  /** Tempo médio de treino dos alunos do coach (últimos 30 dias). */
  async coachAvgDuration(coachId: string) {
    const students = await this.prisma.student.findMany({
      where: { coachId },
      select: { id: true, userId: true },
    });

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const sessions = await this.prisma.workoutSession.findMany({
      where: { athleteId: { in: students.map(s => s.userId) }, startedAt: { gte: since } },
      select: { athleteId: true, elapsedSeconds: true },
    });

    const all = sessions.map(s => s.elapsedSeconds);
    const byAthlete = new Map<string, number[]>();
    for (const s of sessions) {
      const arr = byAthlete.get(s.athleteId) ?? [];
      arr.push(s.elapsedSeconds);
      byAthlete.set(s.athleteId, arr);
    }

    const byStudent = students.map(s => {
      const vals = byAthlete.get(s.userId) ?? [];
      return { studentId: s.id, avgSeconds: this.mean(vals), count: vals.length };
    });

    return {
      overallAvgSeconds: this.mean(all),
      totalSessions: sessions.length,
      byStudent,
    };
  }
}
