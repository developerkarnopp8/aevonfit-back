import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkoutLogDto } from './create-workout-log.dto';

describe('CreateWorkoutLogDto — durationSeconds com Min/Max', () => {
  const base = { exerciseId: 'ex-1', setsCompleted: 3 };

  it('aceita durationSeconds até 43200 (12h)', async () => {
    const dto = plainToInstance(CreateWorkoutLogDto, { ...base, durationSeconds: 43200 });
    const errors = await validate(dto);
    expect(errors.find(e => e.property === 'durationSeconds')).toBeUndefined();
  });

  it('rejeita durationSeconds acima de 43200', async () => {
    const dto = plainToInstance(CreateWorkoutLogDto, { ...base, durationSeconds: 43201 });
    const errors = await validate(dto);
    const err = errors.find(e => e.property === 'durationSeconds');
    expect(err).toBeDefined();
    expect(err!.constraints).toHaveProperty('max');
  });

  it('rejeita durationSeconds negativo', async () => {
    const dto = plainToInstance(CreateWorkoutLogDto, { ...base, durationSeconds: -1 });
    const errors = await validate(dto);
    const err = errors.find(e => e.property === 'durationSeconds');
    expect(err).toBeDefined();
    expect(err!.constraints).toHaveProperty('min');
  });

  it('continua opcional — sem durationSeconds não gera erro', async () => {
    const dto = plainToInstance(CreateWorkoutLogDto, { ...base });
    const errors = await validate(dto);
    expect(errors.find(e => e.property === 'durationSeconds')).toBeUndefined();
  });
});
