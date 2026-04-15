import { IsString, IsOptional, IsNumber, IsUrl, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateExerciseLibraryDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() youtubeUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) sets?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reps?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() duration?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) restSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) loadPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateExerciseLibraryDto extends PartialType(CreateExerciseLibraryDto) {}
