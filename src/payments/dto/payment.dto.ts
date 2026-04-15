import { IsString, IsOptional, IsNumber, IsDateString, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty() @IsString() studentId: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiProperty() @IsDateString() dueDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class UpdatePaymentDto extends PartialType(CreatePaymentDto) {
  @ApiPropertyOptional() @IsOptional() @IsEnum(['pending', 'paid', 'overdue']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() paidAt?: string;
}
