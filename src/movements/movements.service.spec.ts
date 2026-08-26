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

describe('MovementsService.isAvailableForUser', () => {
  let service: MovementsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      movement: { findFirst: jest.fn() },
      student: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [MovementsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(MovementsService);
  });

  it('atleta: retorna true quando o movimento e global ou do proprio coach', async () => {
    prisma.student.findFirst.mockResolvedValue({ coachId: 'coach-9' });
    prisma.movement.findFirst.mockResolvedValue({ id: 'mov-1' });

    const result = await service.isAvailableForUser({ id: 'athlete-1', role: 'athlete' }, 'mov-1');

    expect(prisma.movement.findFirst).toHaveBeenCalledWith({
      where: { id: 'mov-1', OR: [{ coachId: null }, { coachId: 'coach-9' }] },
      select: { id: true },
    });
    expect(result).toBe(true);
  });

  it('atleta: retorna false quando o movimento pertence a outro coach', async () => {
    prisma.student.findFirst.mockResolvedValue({ coachId: 'coach-9' });
    prisma.movement.findFirst.mockResolvedValue(null);

    const result = await service.isAvailableForUser({ id: 'athlete-1', role: 'athlete' }, 'mov-de-outro-coach');

    expect(result).toBe(false);
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
