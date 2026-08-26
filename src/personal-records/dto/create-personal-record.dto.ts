import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePersonalRecordDto {
  @ApiProperty()
  @IsUUID()
  movementId!: string;

  @ApiProperty({ required: false, description: 'Carga em kg' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  loadKg?: number;

  @ApiProperty({ required: false, description: 'Repetições máximas' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  reps?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
