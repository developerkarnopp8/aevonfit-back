import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class MovementsService {
  constructor(private prisma: PrismaService) {}

  /** Catálogo disponível: movimentos globais (coachId null) + customizados do coach do usuário. */
  async findAvailable(user: AuthUser) {
    const coachId = await this.resolveCoachId(user);
    return this.prisma.movement.findMany({
      where: { OR: [{ coachId: null }, { coachId }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /** Confirma que movementId está no catálogo disponível pro usuário (global ou do próprio coach). */
  async isAvailableForUser(user: AuthUser, movementId: string): Promise<boolean> {
    const coachId = await this.resolveCoachId(user);
    const movement = await this.prisma.movement.findFirst({
      where: { id: movementId, OR: [{ coachId: null }, { coachId }] },
      select: { id: true },
    });
    return movement != null;
  }

  async create(coachId: string, dto: CreateMovementDto) {
    return this.prisma.movement.create({
      data: { name: dto.name, category: dto.category, coachId },
    });
  }

  private async resolveCoachId(user: AuthUser): Promise<string | null> {
    if (user.role === 'coach') {
      return user.id;
    }
    const student = await this.prisma.student.findFirst({
      where: { userId: user.id },
      select: { coachId: true },
    });
    return student?.coachId ?? null;
  }
}
