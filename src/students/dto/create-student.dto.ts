import { IsString, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiProperty({ description: 'ID do User já criado para este atleta' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ example: 'Competição CrossFit' })
  @IsString()
  @IsOptional()
  goal?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  currentMonth?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  currentWeek?: number;
}

export class UpdateStudentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  goal?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  currentMonth?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  currentWeek?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  completionPercent?: number;
}
