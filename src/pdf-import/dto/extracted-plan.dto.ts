import {
  IsString, IsNumber, IsOptional, IsEnum, IsArray,
  ValidateNested, ArrayMinSize, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SessionType } from '../../training-plans/dto/training-plan.dto';

export class ExtractedExerciseDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  youtubeUrl?: string;

  @IsNumber()
  @IsOptional()
  sets?: number;

  @IsString()
  @IsOptional()
  reps?: string;

  @IsString()
  @IsOptional()
  duration?: string;

  @IsNumber()
  @IsOptional()
  restSeconds?: number;

  @IsNumber()
  @IsOptional()
  loadPercent?: number;

  @IsString()
  @IsOptional()
  coachNotes?: string;

  @IsNumber()
  order: number;
}

export class ExtractedSessionDto {
  @IsString()
  name: string;

  @IsEnum(SessionType)
  type: SessionType;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedExerciseDto)
  exercises: ExtractedExerciseDto[];
}

export class ExtractedDayDto {
  @IsString()
  dayOfWeek: string;

  @IsNumber()
  @Min(0)
  @Max(6)
  dayIndex: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedSessionDto)
  sessions: ExtractedSessionDto[];
}

export class ExtractedWeekDto {
  @IsNumber()
  weekNumber: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedDayDto)
  days: ExtractedDayDto[];
}

export class ExtractedPlanDto {
  @IsString()
  planTitle: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedWeekDto)
  weeks: ExtractedWeekDto[];
}
