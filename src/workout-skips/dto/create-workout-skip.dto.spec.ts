import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkoutSkipDto } from './create-workout-skip.dto';

describe('CreateWorkoutSkipDto — note com MaxLength', () => {
  const base = {
    exerciseId: '11111111-1111-4111-8111-111111111111',
    reason: 'NoTime',
    decision: 'Postponed',
  };

  it('aceita note com até 500 caracteres', async () => {
    const dto = plainToInstance(CreateWorkoutSkipDto, { ...base, note: 'a'.repeat(500) });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejeita note com mais de 500 caracteres', async () => {
    const dto = plainToInstance(CreateWorkoutSkipDto, { ...base, note: 'a'.repeat(501) });
    const errors = await validate(dto);
    const noteError = errors.find(e => e.property === 'note');
    expect(noteError).toBeDefined();
    expect(noteError!.constraints).toHaveProperty('maxLength');
  });

  it('continua opcional — sem note nao gera erro', async () => {
    const dto = plainToInstance(CreateWorkoutSkipDto, { ...base });
    const errors = await validate(dto);
    expect(errors.find(e => e.property === 'note')).toBeUndefined();
  });
});
