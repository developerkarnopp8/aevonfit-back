import { Test } from '@nestjs/testing';
import { MovementsService } from './movements.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MovementsService.findAvailable', () => {
  let service: MovementsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      movement: { findMany: jest.fn().mockResolvedValue([]) },
      student: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [MovementsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(MovementsService);
  });

  it('coach: busca globais + customizados do proprio coachId', async () => {
    await service.findAvailable({ id: 'coach-1', role: 'coach' });

    expect(prisma.movement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ coachId: null }, { coachId: 'coach-1' }] },
      }),
    );
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it('atleta: resolve o coachId do proprio coach antes de buscar', async () => {
    prisma.student.findFirst.mockResolvedValue({ coachId: 'coach-9' });

    await service.findAvailable({ id: 'athlete-1', role: 'athlete' });

    expect(prisma.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'athlete-1' } }),
    );
    expect(prisma.movement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ coachId: null }, { coachId: 'coach-9' }] },
      }),
    );
  });
});

describe('MovementsService.create', () => {
  let service: MovementsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { movement: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [MovementsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(MovementsService);
  });

  it('cria movimento customizado com o coachId de quem esta logado', async () => {
    prisma.movement.create.mockResolvedValue({ id: 'm1', name: 'Zercher Squat', category: 'Força', coachId: 'coach-1' });

    await service.create('coach-1', { name: 'Zercher Squat', category: 'Força' });

    expect(prisma.movement.create).toHaveBeenCalledWith({
      data: { name: 'Zercher Squat', category: 'Força', coachId: 'coach-1' },
    });
  });
});
