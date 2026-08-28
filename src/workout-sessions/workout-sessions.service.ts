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
}
