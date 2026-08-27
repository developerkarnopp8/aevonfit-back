import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExtractedPlanDto } from './extracted-plan.dto';

describe('ExtractedPlanDto — validação do JSON devolvido pela IA', () => {
  const validPayload = {
    planTitle: 'Mesociclo 6',
    weeks: [
      {
        weekNumber: 1,
        days: [
          {
            dayOfWeek: 'Terça',
            dayIndex: 2,
            sessions: [
              {
                name: 'Sessão 1 — LPO',
                type: 'LPO',
                order: 1,
                exercises: [
                  { name: 'Snatch Complex', sets: 6, reps: '2 reps', order: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('aceita um payload completo e válido', async () => {
    const instance = plainToInstance(ExtractedPlanDto, validPayload);
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });

  it('rejeita quando weeks está vazio', async () => {
    const instance = plainToInstance(ExtractedPlanDto, { ...validPayload, weeks: [] });
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejeita quando falta planTitle', async () => {
    const { planTitle, ...withoutTitle } = validPayload;
    const instance = plainToInstance(ExtractedPlanDto, withoutTitle);
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejeita session.type fora do enum SessionType', async () => {
    const bad = {
      ...validPayload,
      weeks: [{
        ...validPayload.weeks[0],
        days: [{
          ...validPayload.weeks[0].days[0],
          sessions: [{ ...validPayload.weeks[0].days[0].sessions[0], type: 'NaoExiste' }],
        }],
      }],
    };
    const instance = plainToInstance(ExtractedPlanDto, bad);
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('aceita exercício só com os campos obrigatórios (name, order)', async () => {
    const minimal = {
      planTitle: 'Plano mínimo',
      weeks: [{
        weekNumber: 1,
        days: [{
          dayOfWeek: 'Segunda',
          dayIndex: 1,
          sessions: [{
            name: 'Sessão única',
            type: 'Strength',
            order: 1,
            exercises: [{ name: 'Back Squat', order: 1 }],
          }],
        }],
      }],
    };
    const instance = plainToInstance(ExtractedPlanDto, minimal);
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });
});
