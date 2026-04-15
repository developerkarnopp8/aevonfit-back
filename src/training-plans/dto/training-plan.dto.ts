import {
  IsString, IsNumber, IsBoolean, IsOptional, IsEnum,
  IsUrl, IsArray, ValidateNested, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SessionType {
  Mobility = 'Mobility',
  LPO = 'LPO',
  Strength = 'Strength',
  Gymnastics = 'Gymnastics',
  Metcon = 'Metcon',
  Endurance = 'Endurance',
  Core = 'Core',
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export class CreatePlanDto {
  @ApiProperty({ description: 'ID do aluno' })
  @IsString()
  studentId: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  month: number;

  @ApiProperty({ example: 'Mês 1 — Programação Gustavo' })
  @IsString()
  title: string;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  published?: boolean;
}

// ── Week ─────────────────────────────────────────────────────────────────────

export class CreateWeekDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  weekNumber: number;
}

// ── Day ──────────────────────────────────────────────────────────────────────

export class CreateDayDto {
  @ApiProperty({ example: 'Terça' })
  @IsString()
  dayOfWeek: string;

  @ApiProperty({ example: 2, description: '0 = Dom, 1 = Seg, ..., 6 = Sáb' })
  @IsNumber()
  @Min(0)
  @Max(6)
  dayIndex: number;
}

// ── Session ──────────────────────────────────────────────────────────────────

export class CreateSessionDto {
  @ApiProperty({ example: 'Sessão 1 — LPO (Snatch)' })
  @IsString()
  name: string;

  @ApiProperty({ enum: SessionType })
  @IsEnum(SessionType)
  type: SessionType;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;
}

// ── Exercise ─────────────────────────────────────────────────────────────────

export class CreateExerciseDto {
  @ApiProperty({ example: 'Snatch Complex' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/...' })
  @IsOptional()
  youtubeUrl?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsNumber()
  @IsOptional()
  sets?: number;

  @ApiPropertyOptional({ example: '3 reps' })
  @IsString()
  @IsOptional()
  reps?: string;

  @ApiPropertyOptional({ example: '45 segundos' })
  @IsString()
  @IsOptional()
  duration?: string;

  @ApiPropertyOptional({ example: 90 })
  @IsNumber()
  @IsOptional()
  restSeconds?: number;

  @ApiPropertyOptional({ example: 75 })
  @IsNumber()
  @IsOptional()
  loadPercent?: number;

  @ApiPropertyOptional({ example: 'Mantenha o core ativo' })
  @IsString()
  @IsOptional()
  coachNotes?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;
}

export class UpdateExerciseDto extends CreateExerciseDto {}
