import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseLibraryDto, UpdateExerciseLibraryDto } from './dto/exercise-library.dto';

@Injectable()
export class ExerciseLibraryService {
  constructor(private prisma: PrismaService) {}

  findAll(coachId: string) {
    return this.prisma.exerciseLibrary.findMany({
      where: { coachId },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, coachId: string) {
    const item = await this.prisma.exerciseLibrary.findFirst({ where: { id, coachId } });
    if (!item) throw new NotFoundException('Exercício não encontrado');
    return item;
  }

  create(coachId: string, dto: CreateExerciseLibraryDto) {
    return this.prisma.exerciseLibrary.create({ data: { ...dto, coachId } });
  }

  async update(id: string, coachId: string, dto: UpdateExerciseLibraryDto) {
    await this.findOne(id, coachId);
    return this.prisma.exerciseLibrary.update({ where: { id }, data: dto });
  }

  async remove(id: string, coachId: string) {
    await this.findOne(id, coachId);
    return this.prisma.exerciseLibrary.delete({ where: { id } });
  }
}
