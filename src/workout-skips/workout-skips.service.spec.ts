import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MessagesService } from '../messages/messages.service';

describe('WorkoutSkipsService.create', () => {
  let service: WorkoutSkipsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  let messagesService: { send: jest.Mock };

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

    const module = await Test.createTestingModule({
      providers: [
        WorkoutSkipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
        { provide: MessagesService, useValue: messagesService },
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
});
