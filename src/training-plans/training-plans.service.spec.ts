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
