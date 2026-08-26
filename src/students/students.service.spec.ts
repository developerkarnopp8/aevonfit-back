import { Test } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * completionPercent era uma coluna estática do banco (@default(0), nunca
 * recalculada em lugar nenhum — na prática ficou travada no valor de seed
 * "68" migrado do antigo db.json mock) — reportado pelo usuário ("E o dash
 * do coach esta 68") vendo o número não bater com o progresso real do
 * atleta. Agora é computado dinamicamente a partir dos exercícios com
 * WorkoutLog no plano do mês atual do aluno.
 */
describe('StudentsService.findAll — completionPercent computado dinamicamente', () => {
  let service: StudentsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      student: { findMany: jest.fn() },
      trainingPlan: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [StudentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(StudentsService);
  });

  it('calcula o % real de exercícios concluídos no plano do mês atual do aluno', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue({
      weeks: [
        {
          days: [
            {
              sessions: [
                { exercises: [{ workoutLogs: [{ id: 'log-1' }] }, { workoutLogs: [] }] },
                { exercises: [{ workoutLogs: [{ id: 'log-2' }] }] },
              ],
            },
          ],
        },
      ],
    });

    const result = await service.findAll('coach-1');

    // 2 de 3 exercicios com log = 67%
    expect(result[0].completionPercent).toBe(67);
    expect(prisma.trainingPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: 'student-1', month: 2 } }),
    );
  });

  it('retorna 0% quando o aluno nao tem plano no mes atual', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 3, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue(null);

    const result = await service.findAll('coach-1');

    expect(result[0].completionPercent).toBe(0);
  });

  it('retorna 0% quando o plano nao tem nenhum exercicio ainda', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 1, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue({ weeks: [] });

    const result = await service.findAll('coach-1');

    expect(result[0].completionPercent).toBe(0);
  });

  it('filtra workoutLogs pelo userId (athleteId) do proprio aluno, nao de outro', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue({ weeks: [] });

    await service.findAll('coach-1');

    expect(prisma.trainingPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          weeks: expect.objectContaining({
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
        }),
      }),
    );
  });
});
