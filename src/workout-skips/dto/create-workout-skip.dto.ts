import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { SkipReason, SkipDecision } from '@prisma/client';

export class CreateWorkoutSkipDto {
  @ApiProperty({ required: false })
  @ValidateIf(o => !o.sessionId)
  @IsUUID()
  exerciseId?: string;

  @ApiProperty({ required: false })
  @ValidateIf(o => !o.exerciseId)
  @IsUUID()
  sessionId?: string;

  @ApiProperty({ enum: SkipReason })
  @IsEnum(SkipReason)
  reason!: SkipReason;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ enum: SkipDecision })
  @IsEnum(SkipDecision)
  decision!: SkipDecision;
}
