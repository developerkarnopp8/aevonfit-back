import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/create-student.dto';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(coachId?: string) {
    return this.prisma.student.findMany({
      where: coachId ? { coachId } : undefined,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
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
    return student;
  }

  async create(coachId: string, dto: CreateStudentDto) {
    return this.prisma.student.create({
      data: {
        userId: dto.userId,
        coachId,
        goal: dto.goal,
        currentMonth: dto.currentMonth ?? 1,
        currentWeek: dto.currentWeek ?? 1,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async update(id: string, dto: UpdateStudentDto) {
    await this.findOne(id);
    return this.prisma.student.update({
      where: { id },
      data: dto,
    });
  }

  async getCurrentPlan(studentId: string) {
    const student = await this.findOne(studentId);
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { studentId, published: true },
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
