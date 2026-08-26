import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cobre o achado 7 da revisão final: GET /sessions/:id precisa incluir
 * `workoutSkips` (nível sessão e exercício) filtrado pelo athleteId dono
 * do plano, no mesmo padrão aplicado ao fullPlanInclude (achado 1) —
 * sem isso o frontend não sabe que um item já foi pulado.
 */
describe('SessionsService.findById', () => {
  let service: SessionsService;
  let prisma: any;

  const planContext = {
    day: { week: { plan: { coachId: 'coach-1', student: { userId: 'athlete-1' } } } },
  };

  beforeEach(async () => {
    prisma = { session: { findUnique: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [SessionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(SessionsService);
  });

  it('inclui workoutSkips filtrado pelo athleteId dono do plano, em ambos os níveis', async () => {
    prisma.session.findUnique
      .mockResolvedValueOnce(planContext) // consulta de permissão
      .mockResolvedValueOnce({ id: 'sess-1' }); // consulta final

    await service.findById('sess-1', { id: 'athlete-1', role: 'athlete' });

    expect(prisma.session.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          workoutSkips: expect.objectContaining({ where: { athleteId: 'athlete-1' } }),
          exercises: expect.objectContaining({
            include: expect.objectContaining({
              workoutSkips: expect.objectContaining({ where: { athleteId: 'athlete-1' } }),
            }),
          }),
        }),
      }),
    );
  });

  it('usa o athleteId do dono do plano (não o id de quem pediu) quando é o coach que consulta', async () => {
    prisma.session.findUnique
      .mockResolvedValueOnce(planContext)
      .mockResolvedValueOnce({ id: 'sess-1' });

    await service.findById('sess-1', { id: 'coach-1', role: 'coach' });

    expect(prisma.session.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          workoutSkips: expect.objectContaining({ where: { athleteId: 'athlete-1' } }),
        }),
      }),
    );
  });

  it('lança ForbiddenException para quem não é o coach dono nem o próprio aluno', async () => {
    prisma.session.findUnique.mockResolvedValueOnce(planContext);

    await expect(
      service.findById('sess-1', { id: 'intruso', role: 'athlete' }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
  });

  it('lança NotFoundException quando a sessão não existe', async () => {
    prisma.session.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.findById('sess-inexistente', { id: 'athlete-1', role: 'athlete' }),
    ).rejects.toThrow(NotFoundException);
  });
});
