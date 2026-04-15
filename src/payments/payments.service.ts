import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  findAll(coachId: string) {
    return this.prisma.payment.findMany({
      where: { coachId },
      include: {
        student: {
          include: { user: { select: { name: true } } },
        },
      },
      orderBy: { dueDate: 'desc' },
    });
  }

  findByStudent(studentId: string, coachId: string) {
    return this.prisma.payment.findMany({
      where: { studentId, coachId },
      orderBy: { dueDate: 'desc' },
    });
  }

  async findOne(id: string, coachId: string) {
    const p = await this.prisma.payment.findFirst({ where: { id, coachId } });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    return p;
  }

  create(coachId: string, dto: CreatePaymentDto) {
    const { studentId, amount, dueDate, description } = dto;
    return this.prisma.payment.create({
      data: {
        coachId,
        studentId,
        amount,
        dueDate: new Date(dueDate),
        description,
      },
      include: {
        student: { include: { user: { select: { name: true } } } },
      },
    });
  }

  async markPaid(id: string, coachId: string) {
    await this.findOne(id, coachId);
    return this.prisma.payment.update({
      where: { id },
      data: { status: 'paid', paidAt: new Date() },
    });
  }

  async update(id: string, coachId: string, dto: UpdatePaymentDto) {
    await this.findOne(id, coachId);
    const data: any = { ...dto };
    if (dto.dueDate) data.dueDate = new Date(dto.dueDate);
    if (dto.paidAt) data.paidAt = new Date(dto.paidAt);
    return this.prisma.payment.update({ where: { id }, data });
  }

  async remove(id: string, coachId: string) {
    await this.findOne(id, coachId);
    return this.prisma.payment.delete({ where: { id } });
  }

  async getSummary(coachId: string) {
    const now = new Date();
    const payments = await this.prisma.payment.findMany({ where: { coachId } });

    // Auto-mark overdue
    const overdueIds = payments
      .filter(p => p.status === 'pending' && new Date(p.dueDate) < now)
      .map(p => p.id);
    if (overdueIds.length > 0) {
      await this.prisma.payment.updateMany({
        where: { id: { in: overdueIds } },
        data: { status: 'overdue' },
      });
    }

    const fresh = await this.prisma.payment.findMany({ where: { coachId } });
    const totalReceived = fresh.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const totalPending  = fresh.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
    const totalOverdue  = fresh.filter(p => p.status === 'overdue').reduce((s, p) => s + p.amount, 0);
    const countOverdue  = fresh.filter(p => p.status === 'overdue').length;

    return { totalReceived, totalPending, totalOverdue, countOverdue };
  }
}
