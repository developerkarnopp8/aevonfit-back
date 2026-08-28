import { IsString, IsEmail, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCoachDto {
  @ApiProperty({ example: 'Luan Silveira' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'luan@aevonfit.com' })
  @IsEmail()
  email: string;
}

export class ToggleCoachAiDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  aiImportEnabled: boolean;
}
