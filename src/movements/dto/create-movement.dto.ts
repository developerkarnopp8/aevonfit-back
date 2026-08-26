import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const CATEGORIES = ['LPO', 'Força', 'Ginástica', 'Metcon', 'Resistência', 'Mobilidade', 'Core', 'Outro'];

export class CreateMovementDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category!: string;
}
