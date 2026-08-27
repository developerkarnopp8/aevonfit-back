import { Test } from '@nestjs/testing';
import { BadGatewayException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PdfImportService } from './pdf-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';

describe('PdfImportService', () => {
  let service: PdfImportService;
  let prisma: any;
  let extraction: { extract: jest.Mock };

  const coachId = 'coach-1';
  const dto = { studentId: 'student-1', startDate: '2026-09-01' };
  const pdfBuffer = Buffer.from('fake-pdf');

  const validExtraction = {
    planTitle: 'Mesociclo 6',
    weeks: [
      {
        weekNumber: 1,
        days: [
          {
            dayOfWeek: 'Terça',
            dayIndex: 2,
            sessions: [
              {
                name: 'Sessão 1 — LPO',
                type: 'LPO',
                order: 1,
                exercises: [{ name: 'Snatch Complex', sets: 6, reps: '2 reps', order: 1 }],
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ userId: 'athlete-1', coachId }) },
      trainingPlan: {
        create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    extraction = { extract: jest.fn().mockResolvedValue(validExtraction) };

    const module = await Test.createTestingModule({
      providers: [
        PdfImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnthropicExtractionService, useValue: extraction },
      ],
    }).compile();
    service = module.get(PdfImportService);
  });

  it('confere que o aluno pertence ao coach antes de chamar a IA', async () => {
    prisma.student.findUnique.mockResolvedValue({ userId: 'athlete-1', coachId: 'outro-coach' });

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(ForbiddenException);
    expect(extraction.extract).not.toHaveBeenCalled();
  });

  it('lança NotFoundException se o aluno não existe, sem chamar a IA', async () => {
    prisma.student.findUnique.mockResolvedValue(null);

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(NotFoundException);
    expect(extraction.extract).not.toHaveBeenCalled();
  });

  it('cria o plano completo (published: false) quando a extração é válida', async () => {
    const result = await service.importFromPdf(coachId, dto, pdfBuffer);

    expect(result).toEqual({ id: 'plan-1' });
    const createCall = prisma.trainingPlan.create.mock.calls[0][0];
    expect(createCall.data.coachId).toBe(coachId);
    expect(createCall.data.studentId).toBe('student-1');
    expect(createCall.data.published).toBe(false);
    expect(createCall.data.title).toBe('Mesociclo 6');
    expect(createCall.data.weeks.create[0].weekNumber).toBe(1);
    expect(createCall.data.weeks.create[0].days.create[0].dayOfWeek).toBe('Terça');
    expect(createCall.data.weeks.create[0].days.create[0].sessions.create[0].name).toBe('Sessão 1 — LPO');
    expect(createCall.data.weeks.create[0].days.create[0].sessions.create[0].exercises.create[0].name).toBe('Snatch Complex');
  });

  it('lança UnprocessableEntityException quando a extração não tem nenhuma semana válida, sem criar nada', async () => {
    extraction.extract.mockResolvedValue({ planTitle: 'X', weeks: [] });

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(UnprocessableEntityException);
    expect(prisma.trainingPlan.create).not.toHaveBeenCalled();
  });

  it('lança UnprocessableEntityException quando a extração não bate com o schema esperado', async () => {
    extraction.extract.mockResolvedValue({ planTitle: 'X' }); // sem "weeks" — inválido

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(UnprocessableEntityException);
    expect(prisma.trainingPlan.create).not.toHaveBeenCalled();
  });

  it('converte erro da chamada à IA em BadGatewayException (502), sem criar nada', async () => {
    extraction.extract.mockRejectedValue(new Error('network error'));

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(BadGatewayException);
    expect(prisma.trainingPlan.create).not.toHaveBeenCalled();
  });
});
