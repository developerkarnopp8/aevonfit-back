import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { generateStrongPassword } from '../common/generate-strong-password';
import { CreateCoachDto } from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async listCoaches() {
    return this.prisma.user.findMany({
      where: { role: 'coach' },
      select: { id: true, name: true, email: true, aiImportEnabled: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCoach(dto: CreateCoachDto): Promise<{ id: string; name: string; email: string; password: string }> {
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    const password = generateStrongPassword();
    const coach = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'coach',
      },
    });

    return { id: coach.id, name: coach.name, email: coach.email, password };
  }

  async resetCoachPassword(id: string): Promise<{ password: string }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!user || user.role !== 'coach') throw new NotFoundException('Coach não encontrado');

    const password = generateStrongPassword();
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    return { password };
  }

  async toggleCoachAi(id: string, aiImportEnabled: boolean): Promise<{ id: string; aiImportEnabled: boolean }> {
    return this.prisma.user.update({
      where: { id },
      data: { aiImportEnabled },
      select: { id: true, aiImportEnabled: true },
    });
  }
}
