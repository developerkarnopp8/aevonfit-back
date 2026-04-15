import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Request, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos os pagamentos do coach' })
  findAll(@Request() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Totais: recebido, pendente, atrasado' })
  getSummary(@Request() req: any) {
    return this.service.getSummary(req.user.id);
  }

  @Get('student/:studentId')
  @ApiOperation({ summary: 'Lista pagamentos de um aluno' })
  findByStudent(@Request() req: any, @Param('studentId') studentId: string) {
    return this.service.findByStudent(studentId, req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria cobrança para um aluno' })
  create(@Request() req: any, @Body() dto: CreatePaymentDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id/pay')
  @ApiOperation({ summary: 'Marca pagamento como pago' })
  markPaid(@Request() req: any, @Param('id') id: string) {
    return this.service.markPaid(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza dados do pagamento' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    return this.service.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove pagamento' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(id, req.user.id);
  }
}
