import { Controller, Get, Patch, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as últimas 30 notificações do usuário autenticado' })
  findAll(@Request() req: any) {
    return this.service.findAllForUser(req.user.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Conta notificações não lidas' })
  async unreadCount(@Request() req: any) {
    const count = await this.service.unreadCount(req.user.id);
    return { count };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marca uma notificação como lida' })
  markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.service.markAsRead(id, req.user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marca todas as notificações do usuário como lidas' })
  markAllAsRead(@Request() req: any) {
    return this.service.markAllAsRead(req.user.id);
  }
}
