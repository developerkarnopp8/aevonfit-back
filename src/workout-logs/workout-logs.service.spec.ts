import { Test } from '@nestjs/testing';
import { WorkoutLogsService } from './workout-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

describe('WorkoutLogsService.getStudentHistory', () => {
  let service: WorkoutLogsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  const coachUser = { id: 'coach-1', role: 'coach' };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = { workoutLog: { findMany: jest.fn().mockResolvedValue([]) } };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutLogsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(WorkoutLogsService);
  });

  it('checa dono do aluno antes de retornar o histórico', async () => {
    await service.getStudentHistory('student-1', coachUser, 50);

    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', coachUser);
    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { athleteId: 'athlete-1' },
        take: 50,
      }),
    );
  });

  it('propaga ForbiddenException quando o coach não é dono do aluno, sem buscar nada', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(
      service.getStudentHistory('student-1', coachUser, 50),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.workoutLog.findMany).not.toHaveBeenCalled();
  });

  it('usa o limit default de 50 quando não informado', async () => {
    await service.getStudentHistory('student-1', coachUser);

    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});

describe('WorkoutLogsService.logExercise', () => {
  let service: WorkoutLogsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  const athleteUser = { id: 'athlete-1', role: 'athlete' };
  const dto = { exerciseId: 'exercise-1', setsCompleted: 3, notes: undefined, completedAt: undefined };
  const exerciseWithContext = {
    id: 'exercise-1',
    session: { day: { week: { plan: { studentId: 'student-1' } } } },
  };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = {
      exercise: { findUnique: jest.fn().mockResolvedValue(exerciseWithContext) },
      workoutLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutLogsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(WorkoutLogsService);
  });

  it('resolve o studentId dono do exercício e confere posse antes de gravar', async () => {
    await service.logExercise(athleteUser, dto as any);

    expect(prisma.exercise.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'exercise-1' } }),
    );
    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', athleteUser);
    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ exerciseId: 'exercise-1', athleteId: 'athlete-1' }),
      }),
    );
  });

  it('lança NotFoundException quando o exercício não existe, sem gravar nada', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    prisma.exercise.findUnique.mockResolvedValue(null);

    await expect(service.logExercise(athleteUser, dto as any)).rejects.toThrow(NotFoundException);
    expect(prisma.workoutLog.create).not.toHaveBeenCalled();
  });

  it('propaga ForbiddenException quando o exercício pertence a outro aluno, sem gravar nada', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(service.logExercise(athleteUser, dto as any)).rejects.toThrow(ForbiddenException);
    expect(prisma.workoutLog.create).not.toHaveBeenCalled();
  });

  it('grava durationSeconds quando informado no dto', async () => {
    await service.logExercise(athleteUser, { ...dto, durationSeconds: 95 } as any);

    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSeconds: 95 }),
      }),
    );
  });

  it('grava durationSeconds como null quando ausente', async () => {
    await service.logExercise(athleteUser, dto as any);

    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSeconds: null }),
      }),
    );
  });
});
