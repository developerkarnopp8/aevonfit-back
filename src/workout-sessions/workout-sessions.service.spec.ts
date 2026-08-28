import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
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

  it('só conta os logs a partir do startedAt desta execução (janela)', async () => {
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          athleteId: 'athlete-1',
          exercise: { sessionId: 'session-1' },
          completedAt: { gte: new Date('2026-08-28T10:00:00.000Z') },
        }),
      }),
    );
  });

  it('rejeita duração de sessão absurda (20 anos) sem gravar nada', async () => {
    await expect(
      service.checkout(athleteUser, {
        ...dto,
        startedAt: '2006-08-28T10:00:00.000Z',
        finishedAt: '2026-08-28T10:45:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.workoutSession.create).not.toHaveBeenCalled();
  });

  it('aceita uma sessão normal de ~45min (regressão)', async () => {
    const result = await service.checkout(athleteUser, dto);
    expect(result).toBeDefined();
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ elapsedSeconds: 2700 }) }),
    );
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

describe('WorkoutSessionsService.studentSummary', () => {
  let service: WorkoutSessionsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  const coachUser = { id: 'coach-1', role: 'coach' };

  beforeEach(async () => {
    prisma = {
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          { elapsedSeconds: 3000, startedAt: new Date('2026-08-28T00:00:00Z') },
          { elapsedSeconds: 3200, startedAt: new Date('2026-08-27T00:00:00Z') },
          { elapsedSeconds: 3100, startedAt: new Date('2026-08-26T00:00:00Z') },
          { elapsedSeconds: 3600, startedAt: new Date('2026-08-25T00:00:00Z') },
          { elapsedSeconds: 3800, startedAt: new Date('2026-08-24T00:00:00Z') },
          { elapsedSeconds: 4000, startedAt: new Date('2026-08-23T00:00:00Z') },
        ]),
      },
      workoutLog: {
        findMany: jest.fn().mockResolvedValue([
          { durationSeconds: 60, exercise: { name: 'Back Squat' } },
          { durationSeconds: 80, exercise: { name: 'Back Squat' } },
          { durationSeconds: 40, exercise: { name: 'Snatch' } },
        ]),
      },
    };
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

  it('checa posse antes de consultar', async () => {
    studentsService.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.studentSummary('student-1', coachUser)).rejects.toThrow(ForbiddenException);
    expect(prisma.workoutSession.findMany).not.toHaveBeenCalled();
  });

  it('consulta pelas sessões do userId do aluno', async () => {
    await service.studentSummary('student-1', coachUser);
    expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { athleteId: 'athlete-1' } }),
    );
  });

  it('calcula média, tendência (últimas 3 vs 3 anteriores) e tempo médio por exercício', async () => {
    const result = await service.studentSummary('student-1', coachUser);

    expect(result.count).toBe(6);
    expect(result.avgElapsedSeconds).toBe(3450); // média das 6
    // últimas 3 (3000,3200,3100 → 3100) vs 3 anteriores (3600,3800,4000 → 3800)
    expect(result.trend).toEqual({ direction: 'faster', deltaSeconds: -700 });
    expect(result.perExercise).toEqual([
      { exerciseName: 'Back Squat', avgSeconds: 70, samples: 2 },
      { exerciseName: 'Snatch', avgSeconds: 40, samples: 1 },
    ]);
  });

  it('retorna trend new quando há menos de 6 sessões', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([
      { elapsedSeconds: 3000, startedAt: new Date() },
      { elapsedSeconds: 3200, startedAt: new Date() },
    ]);
    const result = await service.studentSummary('student-1', coachUser);
    expect(result.trend.direction).toBe('new');
  });

  it('retorna zerado quando não há sessão nenhuma', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([]);
    prisma.workoutLog.findMany.mockResolvedValue([]);
    const result = await service.studentSummary('student-1', coachUser);
    expect(result).toEqual({
      count: 0, avgElapsedSeconds: 0,
      trend: { direction: 'new', deltaSeconds: 0 }, perExercise: [],
    });
  });
});

describe('WorkoutSessionsService.sessionDetail', () => {
  let service: WorkoutSessionsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  const coachUser = { id: 'coach-1', role: 'coach' };

  beforeEach(async () => {
    prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1', name: 'Segunda A',
          exercises: [
            { id: 'ex-1', name: 'Back Squat', workoutLogs: [{ durationSeconds: 75 }] },
            { id: 'ex-2', name: 'Snatch', workoutLogs: [] },
          ],
        }),
      },
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          { startedAt: new Date('2026-08-28T10:00:00Z'), finishedAt: new Date('2026-08-28T10:40:00Z'),
            elapsedSeconds: 2400, activeSeconds: 1500, status: 'Partial' },
        ]),
      },
    };
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

  it('checa posse antes de consultar', async () => {
    studentsService.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.sessionDetail('student-1', 'session-1', coachUser)).rejects.toThrow(ForbiddenException);
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
  });

  it('lança NotFoundException quando a sessão é de outro aluno, sem consultar execuções', async () => {
    prisma.session.findFirst.mockResolvedValue(null);
    await expect(service.sessionDetail('student-1', 'session-1', coachUser)).rejects.toThrow(NotFoundException);
    expect(prisma.workoutSession.findMany).not.toHaveBeenCalled();
  });

  it('retorna tempo por exercício (último log do aluno) e a última execução', async () => {
    const result = await service.sessionDetail('student-1', 'session-1', coachUser);
    expect(result).toEqual({
      sessionId: 'session-1',
      sessionName: 'Segunda A',
      exercises: [
        { id: 'ex-1', name: 'Back Squat', durationSeconds: 75, completed: true },
        { id: 'ex-2', name: 'Snatch', durationSeconds: null, completed: false },
      ],
      lastExecution: {
        startedAt: new Date('2026-08-28T10:00:00Z'), finishedAt: new Date('2026-08-28T10:40:00Z'),
        elapsedSeconds: 2400, activeSeconds: 1500, status: 'Partial',
      },
      executionCount: 1,
    });
    expect(prisma.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1', day: { week: { plan: { studentId: 'student-1' } } } },
        include: expect.objectContaining({
          exercises: expect.objectContaining({
            include: { workoutLogs: expect.objectContaining({ where: { athleteId: 'athlete-1' } }) },
          }),
        }),
      }),
    );
  });

  it('lastExecution null quando o aluno nunca executou', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([]);
    const result = await service.sessionDetail('student-1', 'session-1', coachUser);
    expect(result.lastExecution).toBeNull();
    expect(result.executionCount).toBe(0);
  });
});

describe('WorkoutSessionsService.coachAvgDuration', () => {
  let service: WorkoutSessionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      student: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'student-1', userId: 'athlete-1' },
          { id: 'student-2', userId: 'athlete-2' },
        ]),
      },
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          { athleteId: 'athlete-1', elapsedSeconds: 3000 },
          { athleteId: 'athlete-1', elapsedSeconds: 3600 },
          { athleteId: 'athlete-2', elapsedSeconds: 1800 },
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

  it('agrega por aluno do coach e no geral, últimos 30 dias', async () => {
    const result = await service.coachAvgDuration('coach-1');

    expect(prisma.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { coachId: 'coach-1' } }),
    );
    expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          athleteId: { in: ['athlete-1', 'athlete-2'] },
          startedAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
    expect(result.overallAvgSeconds).toBe(2800); // (3000+3600+1800)/3
    expect(result.totalSessions).toBe(3);
    expect(result.byStudent).toEqual([
      { studentId: 'student-1', avgSeconds: 3300, count: 2 },
      { studentId: 'student-2', avgSeconds: 1800, count: 1 },
    ]);
  });

  it('retorna zerado e byStudent com zeros quando não há sessão', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([]);
    const result = await service.coachAvgDuration('coach-1');
    expect(result.overallAvgSeconds).toBe(0);
    expect(result.totalSessions).toBe(0);
    expect(result.byStudent).toEqual([
      { studentId: 'student-1', avgSeconds: 0, count: 0 },
      { studentId: 'student-2', avgSeconds: 0, count: 0 },
    ]);
  });
});
