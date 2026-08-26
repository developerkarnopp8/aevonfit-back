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
