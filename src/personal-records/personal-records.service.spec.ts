import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PersonalRecordsService } from './personal-records.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

describe('PersonalRecordsService.create', () => {
  let service: PersonalRecordsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { personalRecord: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('cria o registro com loadKg', async () => {
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr1' });

    await service.create('athlete-1', { movementId: 'mov-1', loadKg: 120 } as any);

    expect(prisma.personalRecord.create).toHaveBeenCalledWith({
      data: { athleteId: 'athlete-1', movementId: 'mov-1', loadKg: 120, reps: undefined, note: undefined },
    });
  });

  it('cria o registro so com reps (movimento de corpo livre)', async () => {
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr2' });

    await service.create('athlete-1', { movementId: 'mov-2', reps: 15 } as any);

    expect(prisma.personalRecord.create).toHaveBeenCalledWith({
      data: { athleteId: 'athlete-1', movementId: 'mov-2', loadKg: undefined, reps: 15, note: undefined },
    });
  });

  it('rejeita quando nem loadKg nem reps sao informados', async () => {
    await expect(
      service.create('athlete-1', { movementId: 'mov-1' } as any),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.personalRecord.create).not.toHaveBeenCalled();
  });
});

describe('PersonalRecordsService.getMyHistory', () => {
  let service: PersonalRecordsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { personalRecord: { findMany: jest.fn().mockResolvedValue([]) } };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('busca o historico do proprio atleta, mais recente primeiro, com o movimento incluido', async () => {
    await service.getMyHistory('athlete-1');

    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { athleteId: 'athlete-1' },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  });
});

describe('PersonalRecordsService.getHistoryForStudent', () => {
  let service: PersonalRecordsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  const coachUser = { id: 'coach-1', role: 'coach' };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = { personalRecord: { findMany: jest.fn().mockResolvedValue([]) } };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('checa dono do aluno antes de retornar o historico', async () => {
    await service.getHistoryForStudent('student-1', coachUser);

    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', coachUser);
    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { athleteId: 'athlete-1' },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  });

  it('propaga ForbiddenException quando o coach nao e dono do aluno, sem buscar nada', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(
      service.getHistoryForStudent('student-1', coachUser),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.personalRecord.findMany).not.toHaveBeenCalled();
  });
});
