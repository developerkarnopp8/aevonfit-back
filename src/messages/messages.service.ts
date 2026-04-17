import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesGateway } from './messages.gateway';

const userSelect = { id: true, name: true, role: true };

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MessagesGateway))
    private gateway: MessagesGateway,
  ) {}

  /** Retorna a conversa entre dois usuários, ordenada por data */
  async getConversation(userId: string, otherId: string) {
    await this.prisma.message.updateMany({
      where: { fromId: otherId, toId: userId, read: false },
      data: { read: true },
    });

    return this.prisma.message.findMany({
      where: {
        OR: [
          { fromId: userId, toId: otherId },
          { fromId: otherId, toId: userId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        from: { select: userSelect },
        to:   { select: userSelect },
      },
    });
  }

  /** Lista todas as conversas do usuário (última mensagem por interlocutor) */
  async getInbox(userId: string) {
    const messages = await this.prisma.message.findMany({
      where: { OR: [{ fromId: userId }, { toId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        from: { select: userSelect },
        to:   { select: userSelect },
      },
    });

    // Deduplica: uma entrada por interlocutor (última mensagem)
    const seen = new Set<string>();
    return messages.filter(m => {
      const otherId = m.fromId === userId ? m.toId : m.fromId;
      if (seen.has(otherId)) return false;
      seen.add(otherId);
      return true;
    });
  }

  /** Conta mensagens não lidas */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.message.count({ where: { toId: userId, read: false } });
  }

  async send(fromId: string, toId: string, content: string) {
    const message = await this.prisma.message.create({
      data: { fromId, toId, content },
      include: {
        from: { select: userSelect },
        to:   { select: userSelect },
      },
    });
    // Emite em tempo real para o destinatário
    this.gateway.emitToUser(toId, message);
    return message;
  }
}
