import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MessagesService } from '../messages/messages.service';
import { CreateWorkoutSkipDto } from './dto/create-workout-skip.dto';

type AuthUser = { id: string; role: string };

const REASON_LABEL: Record<string, string> = {
  NoTime: 'sem tempo',
  Injury: 'lesão/dor',
  Later: 'vai fazer depois',
  Other: 'outro motivo',
};

@Injectable()
export class WorkoutSkipsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private messagesService: MessagesService,
  ) {}

  async create(dto: CreateWorkoutSkipDto, user: AuthUser) {
    if ((!dto.exerciseId && !dto.sessionId) || (dto.exerciseId && dto.sessionId)) {
      throw new BadRequestException('Informe exatamente um entre exerciseId ou sessionId.');
    }

    const target = dto.exerciseId
      ? await this.loadExerciseContext(dto.exerciseId)
      : await this.loadSessionContext(dto.sessionId!);

    const student = await this.studentsService.findOne(target.studentId, user);

    const skip = await this.prisma.workoutSkip.create({
      data: {
        exerciseId: dto.exerciseId,
        sessionId: dto.sessionId,
        athleteId: user.id,
        reason: dto.reason,
        note: dto.note,
        decision: dto.decision,
      },
    });

    const reasonLabel = REASON_LABEL[dto.reason] ?? dto.reason;
    const decisionLabel = dto.decision === 'Postponed' ? 'vai fazer depois' : 'não vai fazer';
    const content = `Pulei "${target.name}" — motivo: ${reasonLabel}. ${decisionLabel}.${dto.note ? ` Nota: ${dto.note}` : ''}`;
    await this.messagesService.send(user.id, student.coachId, content, true);

    return skip;
  }

  private async loadExerciseContext(exerciseId: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { session: { include: { day: { include: { week: { include: { plan: true } } } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercício não encontrado');
    return { name: exercise.name, studentId: exercise.session.day.week.plan.studentId };
  }

  private async loadSessionContext(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { day: { include: { week: { include: { plan: true } } } } },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return { name: session.name, studentId: session.day.week.plan.studentId };
  }
}
