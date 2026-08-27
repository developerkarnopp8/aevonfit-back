import { IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportPdfDto {
  @ApiProperty({ description: 'ID do aluno' })
  @IsString()
  studentId: string;

  @ApiProperty({ example: '2026-09-01', description: 'Data de início real da Semana 1 — string YYYY-MM-DD' })
  @IsDateString()
  startDate: string;
}
