import { Module } from '@nestjs/common';
import { PdfImportController } from './pdf-import.controller';
import { PdfImportService } from './pdf-import.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';

@Module({
  controllers: [PdfImportController],
  providers: [PdfImportService, AnthropicExtractionService],
})
export class PdfImportModule {}
