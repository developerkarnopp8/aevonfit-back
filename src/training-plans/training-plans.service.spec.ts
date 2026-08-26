import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TrainingPlansService } from './training-plans.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cobre o achado 1 da revisão final: `fullPlanInclude` precisa filtrar
 * `workoutLogs`/`workoutSkips` pelo `athleteId` dono do plano — sem isso,
 * dado de outro aluno (log/skip de um exerciseId que não é dele) vazaria
 * no plano visualizado (histórico de IDOR no projeto).
 */
describe('TrainingPlansService — filtro por athleteId em fullPlanInclude', () => {
  let service: TrainingPlansService;
  let prisma: any;

  const athleteUser = { id: 'athlete-1', role: 'athlete' };

  const expectedInclude = (athleteId: string) => ({
    weeks: expect.objectContaining({
      include: expect.objectContaining({
        days: expect.objectContaining({
          include: expect.objectContaining({
            sessions: expect.objectContaining({
              include: expect.objectContaining({
                workoutSkips: expect.objectContaining({ where: { athleteId } }),
                exercises: expect.objectContaining({
                  include: expect.objectContaining({
                    workoutLogs: expect.objectContaining({ where: { athleteId } }),
                    workoutSkips: expect.objectContaining({ where: { athleteId } }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  });

  beforeEach(async () => {
    prisma = {
      student: { findUnique: jest.fn() },
      trainingPlan: { findUnique: jest.fn(), findMany: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [TrainingPlansService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('findByStudent filtra workoutLogs/workoutSkips pelo userId do aluno dono (não pelo id de quem pediu)', async () => {
    prisma.student.findUnique.mockResolvedValue({ coachId: 'coach-1', userId: 'athlete-1' });
    prisma.trainingPlan.findMany.mockResolvedValue([]);

    await service.findByStudent('student-1', athleteUser);

    expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expectedInclude('athlete-1') }),
    );
  });

  it('findByStudent nega acesso a quem não é o coach dono nem o próprio aluno', async () => {
    prisma.student.findUnique.mockResolvedValue({ coachId: 'coach-1', userId: 'athlete-1' });

    await expect(
      service.findByStudent('student-1', { id: 'intruso', role: 'athlete' }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.trainingPlan.findMany).not.toHaveBeenCalled();
  });

  it('findById filtra workoutLogs/workoutSkips pelo userId do aluno dono do plano, mesmo quando é o coach que consulta', async () => {
    const coachUser = { id: 'coach-1', role: 'coach' };
    prisma.trainingPlan.findUnique
      .mockResolvedValueOnce({ coachId: 'coach-1', student: { userId: 'athlete-1' } }) // assertCanViewPlan
      .mockResolvedValueOnce({ id: 'plan-1' }); // busca final

    await service.findById('plan-1', coachUser);

    expect(prisma.trainingPlan.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ include: expectedInclude('athlete-1') }),
    );
  });

  it('findById lança NotFoundException quando o plano não existe', async () => {
    prisma.trainingPlan.findUnique.mockResolvedValueOnce(null);

    await expect(service.findById('plano-inexistente', athleteUser)).rejects.toThrow(NotFoundException);
  });
});

/**
 * Dashboard do coach mostrava um gráfico de "Taxa de Conclusão" 100%
 * hardcoded (array literal fixo, sem nenhuma ligação com dado real) —
 * reportado pelo usuário testando local. getWeeklyCompletionByDayIndex
 * agrega, por dia da semana (dayIndex 0-6), o % real de exercícios
 * concluídos (com WorkoutLog) entre TODOS os alunos do coach, na semana
 * atual de cada um.
 */
describe('TrainingPlansService.getWeeklyCompletionByDayIndex', () => {
  let service: TrainingPlansService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      student: { findMany: jest.fn() },
      week: { findFirst: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [TrainingPlansService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('agrega exercícios concluídos vs total por dayIndex, entre múltiplos alunos', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, currentWeek: 2 },
      { id: 'student-2', userId: 'athlete-2', currentMonth: 1, currentWeek: 3 },
    ]);

    prisma.week.findFirst
      .mockResolvedValueOnce({
        days: [
          {
            dayIndex: 1,
            sessions: [
              { exercises: [{ workoutLogs: [{ id: 'log-1' }] }, { workoutLogs: [] }] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        days: [
          {
            dayIndex: 1,
            sessions: [{ exercises: [{ workoutLogs: [{ id: 'log-2' }] }] }],
          },
        ],
      });

    const result = await service.getWeeklyCompletionByDayIndex('coach-1');

    // dayIndex 1: student-1 (1/2 feito) + student-2 (1/1 feito) = 2/3 = 67%
    expect(result.find(r => r.dayIndex === 1)).toEqual({ dayIndex: 1, percent: 67 });
    // demais dias sem exercício nenhum agregado -> 0%
    expect(result.find(r => r.dayIndex === 0)).toEqual({ dayIndex: 0, percent: 0 });
    expect(result).toHaveLength(7);
  });

  it('filtra workoutLogs pelo athleteId (userId) do próprio aluno dono do plano', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, currentWeek: 2 },
    ]);
    prisma.week.findFirst.mockResolvedValue({ days: [] });

    await service.getWeeklyCompletionByDayIndex('coach-1');

    expect(prisma.week.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { weekNumber: 2, plan: { studentId: 'student-1', month: 2 } },
        include: expect.objectContaining({
          days: expect.objectContaining({
            include: expect.objectContaining({
              sessions: expect.objectContaining({
                include: expect.objectContaining({
                  exercises: expect.objectContaining({
                    include: { workoutLogs: { where: { athleteId: 'athlete-1' }, select: { id: true } } },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('pula aluno sem semana atual encontrada (plano não inicializado), sem quebrar', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 5, currentWeek: 1 },
    ]);
    prisma.week.findFirst.mockResolvedValue(null);

    const result = await service.getWeeklyCompletionByDayIndex('coach-1');

    expect(result).toHaveLength(7);
    expect(result.every(r => r.percent === 0)).toBe(true);
  });

  it('retorna 0% em todos os dias quando o coach não tem alunos', async () => {
    prisma.student.findMany.mockResolvedValue([]);

    const result = await service.getWeeklyCompletionByDayIndex('coach-1');

    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6].map(dayIndex => ({ dayIndex, percent: 0 })));
  });
});
