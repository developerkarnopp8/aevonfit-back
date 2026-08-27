import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { MessagesService } from './messages.service';
import { NotificationsService } from '../notifications/notifications.service';
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
  constructor(
    private readonly service: MessagesService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
  async send(@Request() req: any, @Body() dto: SendMessageDto) {
    const message = await this.service.send(req.user.id, dto.toId, dto.content);
    const recipientLink = req.user.role === 'coach' ? '/athlete/messages' : '/coach/messages';
    await this.notificationsService.create(
      dto.toId,
      'new_message',
      `Nova mensagem de ${req.user.name}`,
      dto.content,
      recipientLink,
    );
    return message;
  }
}
