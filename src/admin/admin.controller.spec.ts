import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminController } from './admin.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('AdminController — guards e roles', () => {
  it('aplica JwtAuthGuard e RolesGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('exige role admin no controller inteiro', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminController);
    expect(roles).toEqual(['admin']);
  });
});
