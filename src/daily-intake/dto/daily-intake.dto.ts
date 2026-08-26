import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';

export class LogHydrationDto {
  @ApiProperty({ description: 'Quantidade de água em mililitros' })
  @IsInt()
  @Min(1)
  @Max(5000)
  amountMl!: number;
}

export class LogCaloriesDto {
  @ApiProperty({ description: 'Calorias da refeição/lanche em kcal' })
  @IsInt()
  @Min(1)
  @Max(5000)
  kcal!: number;
}
