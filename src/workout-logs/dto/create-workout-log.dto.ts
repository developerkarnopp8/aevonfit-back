import { IsString, IsNumber, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkoutLogDto {
  @ApiProperty({ description: 'ID do exercício concluído' })
  @IsString()
  exerciseId: string;

  @ApiProperty({ example: 3, description: 'Séries realizadas' })
  @IsNumber()
  setsCompleted: number;

  @ApiPropertyOptional({ example: 'Aumentei 5kg na última série' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'ISO date — padrão: agora' })
  @IsDateString()
  @IsOptional()
  completedAt?: string;
}
