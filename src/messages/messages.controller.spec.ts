import { Test } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('MessagesController.send — notifica o destinatario', () => {
  let controller: MessagesController;
  let messagesService: { send: jest.Mock };
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    messagesService = { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
    notificationsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    controller = module.get(MessagesController);
  });

  it('coach manda mensagem pro atleta -> notificacao com link pro athlete/messages', async () => {
    const req = { user: { id: 'coach-1', role: 'coach', name: 'Luan' } };

    await controller.send(req, { toId: 'athlete-1', content: 'Bom treino hoje!' });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'athlete-1',
      'new_message',
      'Nova mensagem de Luan',
      'Bom treino hoje!',
      '/athlete/messages',
    );
  });

  it('atleta manda mensagem pro coach -> notificacao com link pro coach/messages', async () => {
    const req = { user: { id: 'athlete-1', role: 'athlete', name: 'Gustavo' } };

    await controller.send(req, { toId: 'coach-1', content: 'Pode ser amanha?' });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'coach-1',
      'new_message',
      'Nova mensagem de Gustavo',
      'Pode ser amanha?',
      '/coach/messages',
    );
  });
});
