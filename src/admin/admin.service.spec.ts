import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'coach-1', name: 'Luan Silveira', email: 'luan@aevonfit.com', aiImportEnabled: true, createdAt: new Date('2026-01-01') },
        ]),
        findUnique: jest.fn().mockResolvedValue({ id: 'coach-1', role: 'coach' }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'coach-2', name: 'Nova Coach', email: 'nova@aevonfit.com' }),
        update: jest.fn().mockResolvedValue({ id: 'coach-1', passwordHash: 'hash' }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AdminService);
  });

  it('lista só usuários com role coach', async () => {
    const result = await service.listCoaches();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'coach' } }),
    );
    expect(result).toEqual([
      { id: 'coach-1', name: 'Luan Silveira', email: 'luan@aevonfit.com', aiImportEnabled: true, createdAt: new Date('2026-01-01') },
    ]);
  });

  it('cria coach novo com senha forte gerada, devolvida uma única vez', async () => {
    const result = await service.createCoach({ name: 'Nova Coach', email: 'nova@aevonfit.com' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'nova@aevonfit.com' } });
    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('coach');
    expect(createCall.data.email).toBe('nova@aevonfit.com');
    expect(createCall.data.passwordHash).toBeDefined();
    expect(createCall.data.passwordHash).not.toBe(result.password); // hash, nunca a senha em texto puro
    expect(result.password.length).toBeGreaterThan(15);
    expect(result.id).toBe('coach-2');
  });

  it('lança ConflictException se o e-mail já existe, sem criar nada', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(service.createCoach({ name: 'X', email: 'ja-existe@aevonfit.com' })).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('reseta a senha de um coach existente, devolvendo a senha nova uma única vez', async () => {
    const result = await service.resetCoachPassword('coach-1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'coach-1' }, select: { role: true } });
    const updateCall = prisma.user.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'coach-1' });
    expect(updateCall.data.passwordHash).toBeDefined();
    expect(result.password.length).toBeGreaterThan(15);
  });

  it('lança NotFoundException ao resetar senha de coach que não existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.resetCoachPassword('inexistente')).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao resetar senha de usuário que não é coach', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'athlete-1', role: 'athlete' });

    await expect(service.resetCoachPassword('athlete-1')).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('liga/desliga aiImportEnabled de um coach', async () => {
    prisma.user.update.mockResolvedValue({ id: 'coach-1', aiImportEnabled: false });

    const result = await service.toggleCoachAi('coach-1', false);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'coach-1' },
      data: { aiImportEnabled: false },
      select: { id: true, aiImportEnabled: true },
    });
    expect(result).toEqual({ id: 'coach-1', aiImportEnabled: false });
  });
});
