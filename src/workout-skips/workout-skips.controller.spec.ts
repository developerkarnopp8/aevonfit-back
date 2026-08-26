import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WorkoutSkipsController } from './workout-skips.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('WorkoutSkipsController — guards e roles', () => {
  it('aplica JwtAuthGuard e RolesGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, WorkoutSkipsController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('create() exige role athlete — só o próprio atleta registra que pulou o treino', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, WorkoutSkipsController.prototype.create);
    expect(roles).toEqual(['athlete']);
  });

  it('getPendingCount() exige role coach — só coach ve a contagem de pendencias dos alunos', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, WorkoutSkipsController.prototype.getPendingCount);
    expect(roles).toEqual(['coach']);
  });
});
