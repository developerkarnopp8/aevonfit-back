import {
  Injectable, NotFoundException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/create-student.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  /** Coach dono do aluno, ou o próprio aluno — ninguém mais. */
  private assertCanAccess(student: { coachId: string; userId: string }, user: AuthUser) {
    const isOwningCoach = user.role === 'coach' && student.coachId === user.id;
    const isSelf = user.role === 'athlete' && student.userId === user.id;
    if (!isOwningCoach && !isSelf) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
  }

  async findByUserId(userId: string) {
    const student = await this.prisma.student.findFirst({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');
    return student;
  }

  async findAll(coachId: string) {
    const students = await this.prisma.student.findMany({
      where: { coachId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      students.map(async s => ({
        ...s,
        completionPercent: await this.computeCompletionPercent(s.id, s.currentMonth, s.userId),
      })),
    );
  }

  /**
   * % real de exercícios com WorkoutLog no plano do mês atual do aluno.
   * `completionPercent` era uma coluna estática (@default(0)) nunca
   * recalculada — na prática ficava travada no valor de seed migrado do
   * mock antigo (68), sem relação com o progresso real.
   */
  private async computeCompletionPercent(studentId: string, month: number, athleteId: string): Promise<number> {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { studentId, month },
      include: {
        weeks: {
          include: {
            days: {
              include: {
                sessions: {
                  include: {
                    exercises: {
                      include: { workoutLogs: { where: { athleteId }, select: { id: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!plan) return 0;

    let total = 0;
    let done = 0;
    for (const week of plan.weeks) {
      for (const day of week.days) {
        for (const session of day.sessions) {
          for (const exercise of session.exercises) {
            total++;
            if (exercise.workoutLogs.length > 0) done++;
          }
        }
      }
    }
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  async findOne(id: string, user: AuthUser) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        trainingPlans: {
          where: { published: true },
          orderBy: { month: 'desc' },
          take: 1,
        },
      },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    this.assertCanAccess(student, user);
    return student;
  }

  async create(coachId: string, dto: CreateStudentDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: { name: dto.name, email: dto.email, passwordHash, role: 'athlete' },
      });
      return tx.student.create({
        data: { userId: user.id, coachId, goal: dto.goal },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    });
  }

  /** Busca simples pro coach dono validar antes de escrever — sem cross-check de role. */
  private async getOwnedByCoach(id: string, coachId: string) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    if (student.coachId !== coachId) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
    return student;
  }

  async update(id: string, coachId: string, dto: UpdateStudentDto) {
    await this.getOwnedByCoach(id, coachId);
    return this.prisma.student.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, coachId: string) {
    const student = await this.getOwnedByCoach(id, coachId);
    // Deleting the User cascades to Student (onDelete: Cascade in schema)
    return this.prisma.user.delete({ where: { id: student.userId } });
  }

  async getCurrentPlan(studentId: string, user: AuthUser) {
    const student = await this.findOne(studentId, user);
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { studentId },
      orderBy: { month: 'desc' },
      include: {
        weeks: {
          orderBy: { weekNumber: 'asc' },
          include: {
            days: {
              orderBy: { dayIndex: 'asc' },
              include: {
                sessions: {
                  orderBy: { order: 'asc' },
                  include: {
                    exercises: { orderBy: { order: 'asc' } },
                  },
                },
              },
            },
          },
        },
      },
    });
    return { student, plan };
  }
}
