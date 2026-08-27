import {
  Controller, Post, Body, Request, UseGuards, UseInterceptors,
  UploadedFile, ParseFilePipeBuilder, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PdfImportService } from './pdf-import.service';
import { ImportPdfDto } from './dto/import-pdf.dto';

const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20MB — limite de sanidade de UX, não técnico

@ApiTags('training-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('training-plans')
export class PdfImportController {
  constructor(private readonly service: PdfImportService) {}

  @Roles('coach')
  @Post('import-pdf')
  @ApiOperation({ summary: 'Cria plano de treino rascunho extraindo a estrutura de um PDF via IA' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  importFromPdf(
    @Request() req: any,
    @Body() dto: ImportPdfDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'application/pdf' })
        .addMaxSizeValidator({ maxSize: MAX_PDF_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    return this.service.importFromPdf(req.user.id, dto, file.buffer);
  }
}
