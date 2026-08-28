import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PdfImportController } from './pdf-import.controller';
import { PdfImportService } from './pdf-import.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PdfImportController],
  providers: [PdfImportService, AnthropicExtractionService],
})
export class PdfImportModule {}
