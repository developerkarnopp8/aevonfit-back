import { IsString, IsNumber, IsInt, Min, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkoutLogDto {
  @ApiProperty({ description: 'ID do exercício concluído' })
  @IsString()
  exerciseId: string;

  @ApiProperty({ example: 3, description: 'Séries realizadas' })
  @IsNumber()
  setsCompleted: number;

  @ApiPropertyOptional({ example: 95, description: 'Tempo de execução real do exercício em segundos' })
  @IsInt()
  @Min(0)
  @IsOptional()
  durationSeconds?: number;

  @ApiPropertyOptional({ example: 'Aumentei 5kg na última série' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'ISO date — padrão: agora' })
  @IsDateString()
  @IsOptional()
  completedAt?: string;
}
