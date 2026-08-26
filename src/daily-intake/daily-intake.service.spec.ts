import { Test } from '@nestjs/testing';
import { DailyIntakeService } from './daily-intake.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

describe('DailyIntakeService.logHydration / logCalories', () => {
  let service: DailyIntakeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      hydrationLog: { create: jest.fn(), findMany: jest.fn() },
      calorieLog: { create: jest.fn(), findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        DailyIntakeService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(DailyIntakeService);
  });

  it('cria um log de hidratacao pro atleta logado', async () => {
    prisma.hydrationLog.create.mockResolvedValue({ id: '1', athleteId: 'athlete-1', amountMl: 250 });

    await service.logHydration('athlete-1', 250);

    expect(prisma.hydrationLog.create).toHaveBeenCalledWith({ data: { athleteId: 'athlete-1', amountMl: 250 } });
  });

  it('cria um log de calorias pro atleta logado', async () => {
    prisma.calorieLog.create.mockResolvedValue({ id: '1', athleteId: 'athlete-1', kcal: 300 });

    await service.logCalories('athlete-1', 300);

    expect(prisma.calorieLog.create).toHaveBeenCalledWith({ data: { athleteId: 'athlete-1', kcal: 300 } });
  });
});

describe('DailyIntakeService.getTodayTotals', () => {
  let service: DailyIntakeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      hydrationLog: { findMany: jest.fn() },
      calorieLog: { findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        DailyIntakeService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(DailyIntakeService);
  });

  it('soma os logs de hoje do proprio atleta', async () => {
    prisma.hydrationLog.findMany.mockResolvedValue([{ amountMl: 250 }, { amountMl: 500 }]);
    prisma.calorieLog.findMany.mockResolvedValue([{ kcal: 300 }, { kcal: 450 }]);

    const result = await service.getTodayTotals('athlete-1');

    expect(result).toEqual({ hydrationMl: 750, calories: 750 });
    expect(prisma.hydrationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ athleteId: 'athlete-1' }) }),
    );
  });

  it('retorna zero quando nao ha logs hoje', async () => {
    prisma.hydrationLog.findMany.mockResolvedValue([]);
    prisma.calorieLog.findMany.mockResolvedValue([]);

    const result = await service.getTodayTotals('athlete-1');

    expect(result).toEqual({ hydrationMl: 0, calories: 0 });
  });
});

describe('DailyIntakeService.getHistoryForStudent', () => {
  let service: DailyIntakeService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  const coachUser = { id: 'coach-1', role: 'coach' };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = {
      hydrationLog: { findMany: jest.fn().mockResolvedValue([]) },
      calorieLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    const module = await Test.createTestingModule({
      providers: [
        DailyIntakeService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(DailyIntakeService);
  });

  it('checa dono do aluno antes de retornar o historico (coach)', async () => {
    await service.getHistoryForStudent('student-1', coachUser);

    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', coachUser);
    expect(prisma.hydrationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ athleteId: 'athlete-1' }) }),
    );
  });

  it('propaga ForbiddenException quando o coach nao e dono do aluno', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(service.getHistoryForStudent('student-1', coachUser)).rejects.toThrow(ForbiddenException);
    expect(prisma.hydrationLog.findMany).not.toHaveBeenCalled();
  });

  it('agrega por dia, retornando 14 dias mesmo sem nenhum log', async () => {
    const result = await service.getHistoryForStudent('student-1', coachUser);

    expect(result).toHaveLength(14);
    expect(result[0]).toEqual({ date: expect.any(String), hydrationMl: 0, calories: 0 });
  });

  it('soma corretamente logs do mesmo dia', async () => {
    const today = new Date().toISOString().slice(0, 10);
    prisma.hydrationLog.findMany.mockResolvedValue([
      { amountMl: 250, loggedAt: new Date() },
      { amountMl: 500, loggedAt: new Date() },
    ]);
    prisma.calorieLog.findMany.mockResolvedValue([{ kcal: 400, loggedAt: new Date() }]);

    const result = await service.getHistoryForStudent('student-1', coachUser);
    const todayBucket = result.find(r => r.date === today);

    expect(todayBucket).toEqual({ date: today, hydrationMl: 750, calories: 400 });
  });
});
