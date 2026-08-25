import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { PrismaService } from '../prisma/prisma.service';

describe('MessagesService.send', () => {
  let service: MessagesService;
  let prisma: { message: { create: jest.Mock } };
  let gateway: { emitToUser: jest.Mock };

  beforeEach(async () => {
    prisma = { message: { create: jest.fn() } };
    gateway = { emitToUser: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  it('cria a mensagem com isSystem=false por padrao', async () => {
    prisma.message.create.mockResolvedValue({ id: '1', isSystem: false });

    await service.send('coach-1', 'athlete-1', 'oi');

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fromId: 'coach-1', toId: 'athlete-1', content: 'oi', isSystem: false } }),
    );
  });

  it('cria a mensagem com isSystem=true quando pedido', async () => {
    prisma.message.create.mockResolvedValue({ id: '2', isSystem: true });

    await service.send('athlete-1', 'coach-1', 'pulei o treino', true);

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fromId: 'athlete-1', toId: 'coach-1', content: 'pulei o treino', isSystem: true } }),
    );
  });

  it('emite a mensagem em tempo real pro destinatario', async () => {
    const created = { id: '3', toId: 'coach-1', isSystem: true };
    prisma.message.create.mockResolvedValue(created);

    await service.send('athlete-1', 'coach-1', 'pulei', true);

    expect(gateway.emitToUser).toHaveBeenCalledWith('coach-1', created);
  });
});
