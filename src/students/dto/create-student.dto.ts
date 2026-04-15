import { IsString, IsOptional, IsNumber, IsEmail, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiProperty({ example: 'Gustavo Karnopp' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'gustavo@email.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Senha de acesso do atleta', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 'Competição CrossFit' })
  @IsString()
  @IsOptional()
  goal?: string;
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
