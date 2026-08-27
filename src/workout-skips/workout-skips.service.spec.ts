import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MessagesService } from '../messages/messages.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('WorkoutSkipsService.create', () => {
  let service: WorkoutSkipsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  let messagesService: { send: jest.Mock };
  let notificationsService: { create: jest.Mock };

  const athlete = { id: 'athlete-1', role: 'athlete' };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = {
      exercise: { findUnique: jest.fn() },
      session: { findUnique: jest.fn() },
      workoutSkip: { create: jest.fn() },
    };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    messagesService = { send: jest.fn().mockResolvedValue({}) };
    notificationsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        WorkoutSkipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
        { provide: MessagesService, useValue: messagesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(WorkoutSkipsService);
  });

  it('rejeita quando nem exerciseId nem sessionId sao passados', async () => {
    await expect(
      service.create({ reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow('exerciseId ou sessionId');
  });

  it('rejeita quando os dois exerciseId e sessionId sao passados', async () => {
    await expect(
      service.create({ exerciseId: 'e1', sessionId: 's1', reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow('exerciseId ou sessionId');
  });

  it('cria o skip de exercicio e envia mensagem automatica pro coach', async () => {
    prisma.exercise.findUnique.mockResolvedValue({
      id: 'ex-1', name: 'HSPU',
      session: { day: { week: { plan: { studentId: 'student-1' } } } },
    });
    prisma.workoutSkip.create.mockResolvedValue({ id: 'skip-1', exerciseId: 'ex-1', decision: 'Postponed' });

    const result = await service.create(
      { exerciseId: 'ex-1', reason: 'NoTime', decision: 'Postponed' } as any,
      athlete,
    );

    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', athlete);
    expect(prisma.workoutSkip.create).toHaveBeenCalledWith({
      data: { exerciseId: 'ex-1', sessionId: undefined, athleteId: 'athlete-1', reason: 'NoTime', note: undefined, decision: 'Postponed' },
    });
    expect(messagesService.send).toHaveBeenCalledWith(
      'athlete-1', 'coach-1', expect.stringContaining('HSPU'), true,
    );
    expect(result).toEqual({ id: 'skip-1', exerciseId: 'ex-1', decision: 'Postponed' });
  });

  it('notifica o coach quando o atleta pula um treino', async () => {
    prisma.exercise.findUnique.mockResolvedValue({
      id: 'ex-1', name: 'HSPU',
      session: { day: { week: { plan: { studentId: 'student-1' } } } },
    });
    prisma.workoutSkip.create.mockResolvedValue({ id: 'skip-1', exerciseId: 'ex-1', decision: 'Postponed' });

    await service.create(
      { exerciseId: 'ex-1', reason: 'NoTime', decision: 'Postponed' } as any,
      athlete,
    );

    expect(notificationsService.create).toHaveBeenCalledWith(
      'coach-1',
      'workout_skipped',
      'Aluno pulou um treino',
      expect.stringContaining('Pulei "HSPU"'),
      '/coach/plan-builder/student-1',
    );
  });

  it('propaga ForbiddenException quando o atleta nao e dono do exercicio', async () => {
    prisma.exercise.findUnique.mockResolvedValue({
      id: 'ex-1', name: 'HSPU',
      session: { day: { week: { plan: { studentId: 'outro-student' } } } },
    });
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(
      service.create({ exerciseId: 'ex-1', reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.workoutSkip.create).not.toHaveBeenCalled();
    expect(messagesService.send).not.toHaveBeenCalled();
  });

  it('lanca NotFoundException quando o exercicio nao existe', async () => {
    prisma.exercise.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ exerciseId: 'ex-inexistente', reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow(NotFoundException);

    expect(studentsService.findOne).not.toHaveBeenCalled();
    expect(prisma.workoutSkip.create).not.toHaveBeenCalled();
    expect(messagesService.send).not.toHaveBeenCalled();
  });

  it('cria o skip de sessao e envia mensagem automatica pro coach', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'sess-1', name: 'Mobilidade',
      day: { week: { plan: { studentId: 'student-1' } } },
    });
    prisma.workoutSkip.create.mockResolvedValue({ id: 'skip-2', sessionId: 'sess-1', decision: 'Abandoned' });

    const result = await service.create(
      { sessionId: 'sess-1', reason: 'Injury', decision: 'Abandoned' } as any,
      athlete,
    );

    expect(prisma.session.findUnique).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      include: { day: { include: { week: { include: { plan: true } } } } },
    });
    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', athlete);
    expect(prisma.workoutSkip.create).toHaveBeenCalledWith({
      data: { exerciseId: undefined, sessionId: 'sess-1', athleteId: 'athlete-1', reason: 'Injury', note: undefined, decision: 'Abandoned' },
    });
    expect(messagesService.send).toHaveBeenCalledWith(
      'athlete-1', 'coach-1', expect.stringContaining('Mobilidade'), true,
    );
    expect(result).toEqual({ id: 'skip-2', sessionId: 'sess-1', decision: 'Abandoned' });
  });

  it('lanca NotFoundException quando a sessao nao existe', async () => {
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ sessionId: 'sess-inexistente', reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow(NotFoundException);

    expect(studentsService.findOne).not.toHaveBeenCalled();
    expect(prisma.workoutSkip.create).not.toHaveBeenCalled();
    expect(messagesService.send).not.toHaveBeenCalled();
  });
});

describe('WorkoutSkipsService.getPendingCountByStudent', () => {
  let service: WorkoutSkipsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      workoutSkip: { findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSkipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
        { provide: MessagesService, useValue: { send: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkoutSkipsService);
  });

  it('agrupa a contagem de skips pendentes por aluno do coach', async () => {
    prisma.workoutSkip.findMany.mockResolvedValue([
      { id: '1', exercise: { session: { day: { week: { plan: { studentId: 'student-1' } } } } }, exerciseId: 'ex-1', sessionId: null, session: null, workoutLogAfter: null },
      { id: '2', exercise: { session: { day: { week: { plan: { studentId: 'student-1' } } } } }, exerciseId: 'ex-2', sessionId: null, session: null, workoutLogAfter: null },
      { id: '3', exercise: null, session: { day: { week: { plan: { studentId: 'student-2' } } } }, exerciseId: null, sessionId: 's-1', workoutLogAfter: null },
    ]);

    const result = await service.getPendingCountByStudent('coach-1');

    expect(result).toEqual([
      { studentId: 'student-1', count: 2 },
      { studentId: 'student-2', count: 1 },
    ]);

    expect(prisma.workoutSkip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          decision: 'Postponed',
          OR: expect.arrayContaining([
            expect.objectContaining({
              exercise: expect.objectContaining({
                workoutLogs: { none: {} },
                session: expect.objectContaining({
                  day: expect.objectContaining({
                    week: expect.objectContaining({
                      plan: { coachId: 'coach-1' },
                    }),
                  }),
                }),
              }),
            }),
            expect.objectContaining({
              session: expect.objectContaining({
                exercises: { some: { workoutLogs: { none: {} } } },
                day: expect.objectContaining({
                  week: expect.objectContaining({
                    plan: { coachId: 'coach-1' },
                  }),
                }),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('nao conta uma sessao pulada como pendente pra sempre — braço de sessao exige exercicio ainda sem log', async () => {
    prisma.workoutSkip.findMany.mockResolvedValue([]);

    await service.getPendingCountByStudent('coach-1');

    const call = prisma.workoutSkip.findMany.mock.calls[0][0];
    const sessionArm = call.where.OR[1];
    expect(sessionArm.session.exercises).toEqual({ some: { workoutLogs: { none: {} } } });
  });

  it('deduplica o mesmo exercicio pulado varias vezes — conta no maximo 1 por alvo', async () => {
    prisma.workoutSkip.findMany.mockResolvedValue([
      { id: '1', exercise: { session: { day: { week: { plan: { studentId: 'student-1' } } } } }, exerciseId: 'ex-1', sessionId: null, session: null },
      { id: '2', exercise: { session: { day: { week: { plan: { studentId: 'student-1' } } } } }, exerciseId: 'ex-1', sessionId: null, session: null },
      { id: '3', exercise: null, session: { day: { week: { plan: { studentId: 'student-1' } } } }, exerciseId: null, sessionId: 's-1' },
      { id: '4', exercise: null, session: { day: { week: { plan: { studentId: 'student-1' } } } }, exerciseId: null, sessionId: 's-1' },
    ]);

    const result = await service.getPendingCountByStudent('coach-1');

    expect(result).toEqual([{ studentId: 'student-1', count: 2 }]);
  });
});
