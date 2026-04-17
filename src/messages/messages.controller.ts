import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class SendMessageDto {
  @IsString() toId: string;
  @IsString() @MinLength(1) content: string;
}

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  @Get('inbox')
  @ApiOperation({ summary: 'Lista conversas do usuário (última mensagem por contato)' })
  getInbox(@Request() req: any) {
    return this.service.getInbox(req.user.id);
  }

  @Get('unread')
  @ApiOperation({ summary: 'Conta mensagens não lidas' })
  async unread(@Request() req: any) {
    const count = await this.service.unreadCount(req.user.id);
    return { count };
  }

  @Get(':otherId')
  @ApiOperation({ summary: 'Retorna conversa com um usuário específico' })
  getConversation(@Param('otherId') otherId: string, @Request() req: any) {
    return this.service.getConversation(req.user.id, otherId);
  }

  @Post()
  @ApiOperation({ summary: 'Envia mensagem para um usuário' })
  send(@Request() req: any, @Body() dto: SendMessageDto) {
    return this.service.send(req.user.id, dto.toId, dto.content);
  }
}
