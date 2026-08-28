import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString } from 'class-validator';

export class CheckoutWorkoutSessionDto {
  @ApiProperty({ description: 'ID da sessão do plano que foi executada' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ description: 'ISO — momento do primeiro "Iniciar exercício"' })
  @IsDateString()
  startedAt!: string;

  @ApiProperty({ description: 'ISO — momento do "Finalizar treino"' })
  @IsDateString()
  finishedAt!: string;
}
