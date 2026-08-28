import {
  Injectable, ForbiddenException, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';
import { ImportPdfDto } from './dto/import-pdf.dto';
import { ExtractedPlanDto, ExtractedWeekDto } from './dto/extracted-plan.dto';
import { normalizeToMonday } from '../training-plans/training-plans.service';

const SISTEMA_INDISPONIVEL_MSG =
  'Erro no sistema de importação — nossa equipe já foi avisada. Tente novamente mais tarde ou entre em contato com o suporte.';

@Injectable()
export class PdfImportService {
  constructor(
    private prisma: PrismaService,
    private extraction: AnthropicExtractionService,
    private notifications: NotificationsService,
  ) {}

  async importFromPdf(coachId: string, dto: ImportPdfDto, pdfBuffer: Buffer): Promise<{ id: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
      select: { userId: true, coachId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    if (student.coachId !== coachId) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }

    const coach = await this.prisma.user.findUnique({
      where: { id: coachId },
      select: { aiImportEnabled: true },
    });
    if (!coach?.aiImportEnabled) {
      throw new ForbiddenException('Recurso desativado pra sua conta — entre em contato com o suporte.');
    }

    const raw = await this.extractWithErrorHandling(pdfBuffer);
    const extracted = await this.validateExtraction(raw);

    const month = await this.nextMonthForStudent(dto.studentId);
    const startDate = normalizeToMonday(dto.startDate);

    const plan = await this.prisma.trainingPlan.create({
      data: {
        studentId: dto.studentId,
        coachId,
        month,
        startDate,
        title: extracted.planTitle,
        published: false,
        weeks: {
          create: extracted.weeks.map(week => ({
            weekNumber: week.weekNumber,
            days: {
              create: week.days.map(day => ({
                dayOfWeek: day.dayOfWeek,
                dayIndex: day.dayIndex,
                sessions: {
                  create: day.sessions.map(session => ({
                    name: session.name,
                    type: session.type,
                    order: session.order ?? 0,
                    exercises: {
                      create: session.exercises.map(exercise => ({
                        name: exercise.name,
                        youtubeUrl: exercise.youtubeUrl,
                        sets: exercise.sets,
                        reps: exercise.reps,
                        duration: exercise.duration,
                        restSeconds: exercise.restSeconds,
                        loadPercent: exercise.loadPercent,
                        coachNotes: exercise.coachNotes,
                        order: exercise.order,
                      })),
                    },
                  })),
                },
              })),
            },
          })),
        },
      },
      select: { id: true },
    });

    return plan;
  }

  private async extractWithErrorHandling(pdfBuffer: Buffer): Promise<unknown> {
    try {
      return await this.extraction.extract(pdfBuffer);
    } catch (err) {
      if (this.isCreditExhaustedError(err)) {
        await this.notifyAdminsOfCreditExhaustion();
      }
      throw new ServiceUnavailableException(SISTEMA_INDISPONIVEL_MSG);
    }
  }

  private isCreditExhaustedError(err: unknown): boolean {
    return err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message);
  }

  private async notifyAdminsOfCreditExhaustion(): Promise<void> {
    const admins = await this.prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } });
    for (const admin of admins) {
      const alreadyNotified = await this.prisma.notification.findFirst({
        where: { userId: admin.id, type: 'ai_credit_exhausted', read: false },
      });
      if (alreadyNotified) continue;

      await this.notifications.create(
        admin.id,
        'ai_credit_exhausted',
        'Crédito da IA esgotado',
        'A conta da Anthropic ficou sem crédito — a importação de PDF está fora do ar até adicionar fundo em Plans & Billing.',
        '/admin/coaches',
      );
    }
  }

  private async validateExtraction(raw: unknown): Promise<ExtractedPlanDto> {
    const instance = plainToInstance(ExtractedPlanDto, raw);
    const errors = await validate(instance);
    if (errors.length > 0 || !this.hasAtLeastOneWeek(instance)) {
      throw new UnprocessableEntityException(
        'Não consegui extrair um treino válido desse PDF — tente outro arquivo ou crie o plano manualmente.',
      );
    }
    return instance;
  }

  private hasAtLeastOneWeek(instance: ExtractedPlanDto): boolean {
    return Array.isArray(instance.weeks) && instance.weeks.length > 0
      && instance.weeks.every((w: ExtractedWeekDto) => Array.isArray(w.days) && w.days.length > 0);
  }

  /** Mesma regra já usada no modal "Novo Treino" do frontend: próximo mês ordinal livre do aluno. */
  private async nextMonthForStudent(studentId: string): Promise<number> {
    const existing = await this.prisma.trainingPlan.findMany({
      where: { studentId },
      select: { month: true },
    });
    if (existing.length === 0) return 1;
    return Math.max(...existing.map(p => p.month)) + 1;
  }
}
