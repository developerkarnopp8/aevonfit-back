import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { WorkoutSessionsService } from './workout-sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

const athleteUser = { id: 'athlete-1', role: 'athlete' };

function buildPrisma(overrides: any = {}) {
  return {
    session: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'session-1',
        day: { week: { plan: { studentId: 'student-1', student: { userId: 'athlete-1' } } } },
        exercises: [{ id: 'ex-1' }, { id: 'ex-2' }],
      }),
    },
    workoutLog: {
      findMany: jest.fn().mockResolvedValue([
        { exerciseId: 'ex-1', durationSeconds: 60 },
        { exerciseId: 'ex-2', durationSeconds: 90 },
      ]),
    },
    workoutSession: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ws-1', ...data, session: { name: 'A' } })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe('WorkoutSessionsService.checkout', () => {
  let service: WorkoutSessionsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrisma();
    studentsService = { findOne: jest.fn().mockResolvedValue({ id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' }) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(WorkoutSessionsService);
  });

  const dto = { sessionId: 'session-1', startedAt: '2026-08-28T10:00:00.000Z', finishedAt: '2026-08-28T10:45:00.000Z' };

  it('confere posse do aluno antes de gravar', async () => {
    await service.checkout(athleteUser, dto);
    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', athleteUser);
  });

  it('propaga ForbiddenException sem gravar nada', async () => {
    studentsService.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.checkout(athleteUser, dto)).rejects.toThrow(ForbiddenException);
    expect(prisma.workoutSession.create).not.toHaveBeenCalled();
  });

  it('calcula elapsedSeconds a partir de startedAt/finishedAt', async () => {
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ elapsedSeconds: 2700 }) }),
    );
  });

  it('soma activeSeconds dos durationSeconds dos logs do atleta na sessão', async () => {
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activeSeconds: 150 }) }),
    );
  });

  it('marca Completed quando todos os exercícios têm log do atleta', async () => {
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Completed' }) }),
    );
  });

  it('marca Partial quando falta log de algum exercício', async () => {
    prisma.workoutLog.findMany.mockResolvedValue([{ exerciseId: 'ex-1', durationSeconds: 60 }]);
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Partial' }) }),
    );
  });

  it('rejeita quando finishedAt é anterior a startedAt', async () => {
    await expect(
      service.checkout(athleteUser, { ...dto, finishedAt: '2026-08-28T09:00:00.000Z' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lança BadRequestException quando a sessão não existe', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(service.checkout(athleteUser, dto)).rejects.toThrow(BadRequestException);
  });
});

describe('WorkoutSessionsService.listMine', () => {
  let service: WorkoutSessionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ws-1', sessionId: 's-1', startedAt: new Date('2026-08-28T10:00:00Z'),
            elapsedSeconds: 2700, activeSeconds: 1800, status: 'Completed',
            session: { name: 'Segunda A', type: 'Metcon' },
          },
        ]),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkoutSessionsService);
  });

  it('lista as sessões do próprio atleta, mais recentes primeiro', async () => {
    const result = await service.listMine('athlete-1');

    expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { athleteId: 'athlete-1' },
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
    );
    expect(result[0]).toEqual({
      id: 'ws-1', sessionId: 's-1', sessionName: 'Segunda A', sessionType: 'Metcon',
      startedAt: new Date('2026-08-28T10:00:00Z'), elapsedSeconds: 2700, activeSeconds: 1800, status: 'Completed',
    });
  });
});
