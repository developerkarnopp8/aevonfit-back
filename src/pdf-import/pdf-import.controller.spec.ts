import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PdfImportController } from './pdf-import.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('PdfImportController — guards e roles', () => {
  it('aplica JwtAuthGuard e RolesGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PdfImportController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('importFromPdf() exige role coach', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PdfImportController.prototype.importFromPdf);
    expect(roles).toEqual(['coach']);
  });
});
