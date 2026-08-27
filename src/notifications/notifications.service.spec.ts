import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService.create', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('grava a notificacao com os campos informados', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'n1' });

    await service.create('user-1', 'plan_published', 'Novo plano publicado', 'Seu coach publicou "Mesociclo 1"', '/athlete/weekly');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'plan_published',
        title: 'Novo plano publicado',
        body: 'Seu coach publicou "Mesociclo 1"',
        link: '/athlete/weekly',
      },
    });
  });
});

describe('NotificationsService.findAllForUser', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { findMany: jest.fn().mockResolvedValue([]) } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('busca as notificacoes do proprio usuario, mais recentes primeiro, limitado a 30', async () => {
    await service.findAllForUser('user-1');

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  });
});

describe('NotificationsService.unreadCount', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { count: jest.fn().mockResolvedValue(3) } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('conta so as notificacoes nao lidas do usuario', async () => {
    const result = await service.unreadCount('user-1');

    expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: 'user-1', read: false } });
    expect(result).toBe(3);
  });
});

describe('NotificationsService.markAsRead', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      notification: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('marca como lida quando o usuario e o dono da notificacao', async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'user-1' });
    prisma.notification.update.mockResolvedValue({ id: 'n1', read: true });

    await service.markAsRead('n1', 'user-1');

    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { read: true } });
  });

  it('rejeita com ForbiddenException quando a notificacao e de outro usuario', async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'user-9' });

    await expect(service.markAsRead('n1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('lanca NotFoundException quando a notificacao nao existe', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    await expect(service.markAsRead('n1', 'user-1')).rejects.toThrow(NotFoundException);
  });
});

describe('NotificationsService.markAllAsRead', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { updateMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('marca todas as nao lidas do usuario como lidas', async () => {
    await service.markAllAsRead('user-1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', read: false },
      data: { read: true },
    });
  });
});
