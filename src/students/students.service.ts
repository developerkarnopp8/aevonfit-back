import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/create-student.dto';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

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

  async update(id: string, dto: UpdateStudentDto) {
    await this.findOne(id);
    return this.prisma.student.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const student = await this.findOne(id);
    // Deleting the User cascades to Student (onDelete: Cascade in schema)
    return this.prisma.user.delete({ where: { id: student.userId } });
  }

  async getCurrentPlan(studentId: string) {
    const student = await this.findOne(studentId);
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
