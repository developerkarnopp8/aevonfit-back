import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class MovementsService {
  constructor(private prisma: PrismaService) {}

  /** Catálogo disponível: movimentos globais (coachId null) + customizados do coach do usuário. */
  async findAvailable(user: AuthUser) {
    let coachId: string | null = null;
    if (user.role === 'coach') {
      coachId = user.id;
    } else {
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id },
        select: { coachId: true },
      });
      coachId = student?.coachId ?? null;
    }

    return this.prisma.movement.findMany({
      where: { OR: [{ coachId: null }, { coachId }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async create(coachId: string, dto: CreateMovementDto) {
    return this.prisma.movement.create({
      data: { name: dto.name, category: dto.category, coachId },
    });
  }
}
