# Importação de Plano de Treino via PDF (IA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coach envia um PDF de planilha de treino; uma IA extrai a estrutura completa (semanas/dias/sessões/exercícios) e o sistema cria um `TrainingPlan` rascunho (`published: false`), que o coach revisa/edita na tela de plan-builder já existente e publica quando estiver satisfeito.

**Architecture:** Módulo novo `src/pdf-import/` no backend, isolado de `TrainingPlansService` — um `AnthropicExtractionService` chama a API da Anthropic (tool use, PDF direto sem OCR) e devolve JSON bruto; `PdfImportService` valida esse JSON contra DTOs de `class-validator`, confere que o aluno pertence ao coach (mesmo padrão inline já usado em `TrainingPlansService.create()`), e cria o plano completo numa única chamada Prisma `create()` aninhada. No frontend, o modal "Novo Treino" existente ganha um segundo modo (upload de PDF) que reusa a navegação e o tratamento de erro já existentes.

**Tech Stack:** NestJS + Prisma (backend), `@anthropic-ai/sdk` (novo), Angular 21 + Reactive Forms (frontend).

**Spec:** `backend/docs/superpowers/specs/2026-08-27-importacao-pdf-treino-ia-design.md`

## Global Constraints

- Endpoint: `POST /training-plans/import-pdf`, multipart/form-data, campos `studentId`, `startDate`, `file` (PDF)
- `@Roles('coach')` + `RolesGuard` — mesma checagem de dono do aluno inline já usada em `TrainingPlansService.create()` (não `StudentsService.findOne` — esse método é pra rotas que leem/editam um aluno específico via `:studentId` na URL de forma genérica; `create()` já tem seu próprio padrão inline mais direto, que este endpoint replica)
- Limite de arquivo: 20MB, só `application/pdf`
- Plano criado sempre com `published: false` — nunca visível ao atleta até o coach publicar manualmente (mecanismo já existe, não precisa de mudança)
- IA extrai o PDF **direto** (bloco de documento da API da Anthropic), nunca texto pré-extraído por lib de PDF
- Resposta da IA obrigatoriamente via *tool use* com schema fixo — nunca parsing de JSON solto em texto
- PDF nunca persistido em disco — processado em memória, descartado após a chamada
- `ANTHROPIC_API_KEY` só no backend (env var), nunca no frontend
- Se a IA não extrair nenhuma semana válida → nada é criado, `422` com mensagem clara pro coach
- Data de cada dia é sempre **derivada** de `plan.startDate + (weekNumber-1)×7 + (dayIndex-1)` — nunca armazenada por semana/dia (schema já é assim, `Week`/`TrainingDay` não têm campo de data própria)
- `dayIndex` segue a convenção já usada no projeto: `1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado` (0=Domingo existe no range mas não é usado — não há sessão de domingo neste app)

---

## Backend (`aevonfit-back`)

### Task 1: Exportar `normalizeToMonday` + DTOs de validação da extração da IA

**Files:**
- Modify: `src/training-plans/training-plans.service.ts:18` (adicionar `export` na função `normalizeToMonday`)
- Create: `src/pdf-import/dto/extracted-plan.dto.ts`
- Test: `src/pdf-import/dto/extracted-plan.dto.spec.ts`

**Interfaces:**
- Produces: `normalizeToMonday(isoDateOnly: string): Date` (agora exportada de `training-plans.service.ts`)
- Produces: `ExtractedPlanDto`, `ExtractedWeekDto`, `ExtractedDayDto`, `ExtractedSessionDto`, `ExtractedExerciseDto` (classes com decorators de `class-validator`, usadas pra validar o JSON que a IA devolve antes de confiar nele)

- [ ] **Step 1: Exportar `normalizeToMonday`**

Em `src/training-plans/training-plans.service.ts:18`, trocar:

```ts
function normalizeToMonday(isoDateOnly: string): Date {
```

por:

```ts
export function normalizeToMonday(isoDateOnly: string): Date {
```

Nenhuma outra mudança nesse arquivo — a função já existe e já é usada em `create()`, só precisa ficar exportável pro módulo novo reusar (evita duplicar a mesma lógica de normalização de data em dois lugares).

- [ ] **Step 2: Rodar a suíte pra confirmar que a exportação não quebrou nada**

Run: `npm test -- training-plans.service.spec.ts`
Expected: PASS (nenhum teste existente depende da função ser não-exportada)

- [ ] **Step 3: Escrever o teste das DTOs de extração (validação)**

Criar `src/pdf-import/dto/extracted-plan.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExtractedPlanDto } from './extracted-plan.dto';

describe('ExtractedPlanDto — validação do JSON devolvido pela IA', () => {
  const validPayload = {
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
                exercises: [
                  { name: 'Snatch Complex', sets: 6, reps: '2 reps', order: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('aceita um payload completo e válido', async () => {
    const instance = plainToInstance(ExtractedPlanDto, validPayload);
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });

  it('rejeita quando weeks está vazio', async () => {
    const instance = plainToInstance(ExtractedPlanDto, { ...validPayload, weeks: [] });
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejeita quando falta planTitle', async () => {
    const { planTitle, ...withoutTitle } = validPayload;
    const instance = plainToInstance(ExtractedPlanDto, withoutTitle);
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejeita session.type fora do enum SessionType', async () => {
    const bad = {
      ...validPayload,
      weeks: [{
        ...validPayload.weeks[0],
        days: [{
          ...validPayload.weeks[0].days[0],
          sessions: [{ ...validPayload.weeks[0].days[0].sessions[0], type: 'NaoExiste' }],
        }],
      }],
    };
    const instance = plainToInstance(ExtractedPlanDto, bad);
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('aceita exercício só com os campos obrigatórios (name, order)', async () => {
    const minimal = {
      planTitle: 'Plano mínimo',
      weeks: [{
        weekNumber: 1,
        days: [{
          dayOfWeek: 'Segunda',
          dayIndex: 1,
          sessions: [{
            name: 'Sessão única',
            type: 'Strength',
            order: 1,
            exercises: [{ name: 'Back Squat', order: 1 }],
          }],
        }],
      }],
    };
    const instance = plainToInstance(ExtractedPlanDto, minimal);
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Rodar o teste pra confirmar que falha (arquivo ainda não existe)**

Run: `npm test -- extracted-plan.dto.spec.ts`
Expected: FAIL com "Cannot find module './extracted-plan.dto'"

- [ ] **Step 5: Implementar as DTOs**

Criar `src/pdf-import/dto/extracted-plan.dto.ts`:

```ts
import {
  IsString, IsNumber, IsOptional, IsEnum, IsArray,
  ValidateNested, ArrayMinSize, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SessionType } from '../../training-plans/dto/training-plan.dto';

export class ExtractedExerciseDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  youtubeUrl?: string;

  @IsNumber()
  @IsOptional()
  sets?: number;

  @IsString()
  @IsOptional()
  reps?: string;

  @IsString()
  @IsOptional()
  duration?: string;

  @IsNumber()
  @IsOptional()
  restSeconds?: number;

  @IsNumber()
  @IsOptional()
  loadPercent?: number;

  @IsString()
  @IsOptional()
  coachNotes?: string;

  @IsNumber()
  order: number;
}

export class ExtractedSessionDto {
  @IsString()
  name: string;

  @IsEnum(SessionType)
  type: SessionType;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedExerciseDto)
  exercises: ExtractedExerciseDto[];
}

export class ExtractedDayDto {
  @IsString()
  dayOfWeek: string;

  @IsNumber()
  @Min(0)
  @Max(6)
  dayIndex: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedSessionDto)
  sessions: ExtractedSessionDto[];
}

export class ExtractedWeekDto {
  @IsNumber()
  weekNumber: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedDayDto)
  days: ExtractedDayDto[];
}

export class ExtractedPlanDto {
  @IsString()
  planTitle: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedWeekDto)
  weeks: ExtractedWeekDto[];
}
```

- [ ] **Step 6: Rodar o teste pra confirmar que passa**

Run: `npm test -- extracted-plan.dto.spec.ts`
Expected: PASS (5 testes)

- [ ] **Step 7: Commit**

```bash
git add src/training-plans/training-plans.service.ts src/pdf-import/dto/extracted-plan.dto.ts src/pdf-import/dto/extracted-plan.dto.spec.ts
git commit -m "feat(pdf-import): DTOs de validação da extração da IA"
```

---

### Task 2: `AnthropicExtractionService` — chamada à API com tool use

**Files:**
- Create: `src/pdf-import/anthropic-extraction.service.ts`
- Test: `src/pdf-import/anthropic-extraction.service.spec.ts`
- Modify: `package.json` (adicionar `@anthropic-ai/sdk`)
- Modify: `.env.example` (adicionar `ANTHROPIC_API_KEY`)

**Interfaces:**
- Consumes: nenhuma interface de task anterior (usa só o SDK da Anthropic)
- Produces: `AnthropicExtractionService.extract(pdfBuffer: Buffer): Promise<unknown>` — retorna o JSON bruto que veio do bloco `tool_use` da resposta (ainda não validado — quem chama decide o que fazer com isso; a validação é feita pelas DTOs da Task 1, na Task 3)

- [ ] **Step 1: Instalar a dependência**

Run: `npm install @anthropic-ai/sdk`

- [ ] **Step 2: Adicionar a variável de ambiente ao exemplo**

Em `.env.example`, adicionar a linha:

```
ANTHROPIC_API_KEY="sk-ant-..."
```

- [ ] **Step 3: Escrever o teste (mockando o client da Anthropic — nunca chamar a API de verdade num teste automatizado)**

Criar `src/pdf-import/anthropic-extraction.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AnthropicExtractionService } from './anthropic-extraction.service';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

describe('AnthropicExtractionService', () => {
  let service: AnthropicExtractionService;

  beforeEach(async () => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const module = await Test.createTestingModule({
      providers: [AnthropicExtractionService],
    }).compile();
    service = module.get(AnthropicExtractionService);
  });

  it('manda o PDF como bloco de documento e força tool_choice pra extract_training_plan', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'extract_training_plan', input: { planTitle: 'X', weeks: [] } }],
    });

    await service.extract(Buffer.from('fake-pdf-bytes'));

    const call = mockCreate.mock.calls[0][0];
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'extract_training_plan' });
    expect(call.tools[0].name).toBe('extract_training_plan');
    const documentBlock = call.messages[0].content.find((b: any) => b.type === 'document');
    expect(documentBlock.source.media_type).toBe('application/pdf');
    expect(documentBlock.source.data).toBe(Buffer.from('fake-pdf-bytes').toString('base64'));
  });

  it('retorna o input do bloco tool_use quando a chamada funciona', async () => {
    const extracted = { planTitle: 'Mesociclo 6', weeks: [{ weekNumber: 1, days: [] }] };
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'extract_training_plan', input: extracted }],
    });

    const result = await service.extract(Buffer.from('fake-pdf-bytes'));

    expect(result).toEqual(extracted);
  });

  it('lança erro quando a resposta não tem bloco tool_use', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'não consegui ler' }] });

    await expect(service.extract(Buffer.from('fake-pdf-bytes'))).rejects.toThrow();
  });

  it('propaga erro quando a chamada à API falha (rede, rate limit, etc.)', async () => {
    mockCreate.mockRejectedValue(new Error('network error'));

    await expect(service.extract(Buffer.from('fake-pdf-bytes'))).rejects.toThrow('network error');
  });
});
```

- [ ] **Step 4: Rodar o teste pra confirmar que falha**

Run: `npm test -- anthropic-extraction.service.spec.ts`
Expected: FAIL com "Cannot find module './anthropic-extraction.service'"

- [ ] **Step 5: Implementar o serviço**

Criar `src/pdf-import/anthropic-extraction.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

const EXTRACTION_TOOL = {
  name: 'extract_training_plan',
  description:
    'Extrai a estrutura completa de um plano de treino de CrossFit/força a partir do PDF fornecido — todas as semanas, dias, sessões e exercícios, com o máximo de fidelidade ao conteúdo original (sets, reps, carga, notas do coach).',
  input_schema: {
    type: 'object' as const,
    properties: {
      planTitle: {
        type: 'string',
        description: 'Título/nome do plano, extraído do cabeçalho do PDF (ex: "Mesociclo 6")',
      },
      weeks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            weekNumber: { type: 'number' },
            days: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dayOfWeek: { type: 'string', description: 'Segunda, Terça, Quarta, Quinta, Sexta ou Sábado' },
                  dayIndex: { type: 'number', description: '1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado' },
                  sessions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        type: {
                          type: 'string',
                          enum: ['Mobility', 'LPO', 'Strength', 'Gymnastics', 'Metcon', 'Endurance', 'Core'],
                        },
                        order: { type: 'number' },
                        exercises: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              name: { type: 'string' },
                              youtubeUrl: { type: 'string' },
                              sets: { type: 'number' },
                              reps: { type: 'string' },
                              duration: { type: 'string' },
                              restSeconds: { type: 'number' },
                              loadPercent: { type: 'number' },
                              coachNotes: { type: 'string' },
                              order: { type: 'number' },
                            },
                            required: ['name', 'order'],
                          },
                        },
                      },
                      required: ['name', 'type', 'exercises'],
                    },
                  },
                },
                required: ['dayOfWeek', 'dayIndex', 'sessions'],
              },
            },
          },
          required: ['weekNumber', 'days'],
        },
      },
    },
    required: ['planTitle', 'weeks'],
  },
};

@Injectable()
export class AnthropicExtractionService {
  private readonly client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

  async extract(pdfBuffer: Buffer): Promise<unknown> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_training_plan' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBuffer.toString('base64'),
              },
            },
            {
              type: 'text',
              text: 'Extraia a estrutura completa deste plano de treino usando a ferramenta extract_training_plan. Preserve ao máximo os valores originais de sets/reps/carga/notas — não invente dado que não está no PDF.',
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error('A IA não retornou uma extração estruturada (sem bloco tool_use na resposta).');
    }
    return toolUse.input;
  }
}
```

- [ ] **Step 6: Rodar o teste pra confirmar que passa**

Run: `npm test -- anthropic-extraction.service.spec.ts`
Expected: PASS (4 testes)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example src/pdf-import/anthropic-extraction.service.ts src/pdf-import/anthropic-extraction.service.spec.ts
git commit -m "feat(pdf-import): AnthropicExtractionService com tool use"
```

---

### Task 3: `PdfImportService` — ownership, validação e criação do plano

**Files:**
- Create: `src/pdf-import/pdf-import.service.ts`
- Create: `src/pdf-import/dto/import-pdf.dto.ts`
- Test: `src/pdf-import/pdf-import.service.spec.ts`

**Interfaces:**
- Consumes: `AnthropicExtractionService.extract(pdfBuffer: Buffer): Promise<unknown>` (Task 2), `ExtractedPlanDto` + demais DTOs de extração (Task 1), `normalizeToMonday(isoDateOnly: string): Date` (exportada na Task 1)
- Produces: `PdfImportService.importFromPdf(coachId: string, dto: ImportPdfDto, pdfBuffer: Buffer): Promise<{ id: string }>` — usado pelo controller na Task 4

- [ ] **Step 1: Escrever o DTO do corpo da requisição (campos multipart, fora o arquivo)**

Criar `src/pdf-import/dto/import-pdf.dto.ts`:

```ts
import { IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportPdfDto {
  @ApiProperty({ description: 'ID do aluno' })
  @IsString()
  studentId: string;

  @ApiProperty({ example: '2026-09-01', description: 'Data de início real da Semana 1 — string YYYY-MM-DD' })
  @IsDateString()
  startDate: string;
}
```

- [ ] **Step 2: Escrever o teste do service (mockando Prisma e AnthropicExtractionService)**

Criar `src/pdf-import/pdf-import.service.spec.ts`:

```ts
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
      trainingPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
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
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

Run: `npm test -- pdf-import.service.spec.ts`
Expected: FAIL com "Cannot find module './pdf-import.service'"

- [ ] **Step 4: Implementar o service**

Criar `src/pdf-import/pdf-import.service.ts`:

```ts
import {
  Injectable, BadGatewayException, ForbiddenException,
  NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';
import { ImportPdfDto } from './dto/import-pdf.dto';
import { ExtractedPlanDto, ExtractedWeekDto } from './dto/extracted-plan.dto';
import { normalizeToMonday } from '../training-plans/training-plans.service';

@Injectable()
export class PdfImportService {
  constructor(
    private prisma: PrismaService,
    private extraction: AnthropicExtractionService,
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
    } catch {
      throw new BadGatewayException('Erro ao processar o PDF, tente novamente.');
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
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Run: `npm test -- pdf-import.service.spec.ts`
Expected: PASS (6 testes)

- [ ] **Step 6: Commit**

```bash
git add src/pdf-import/pdf-import.service.ts src/pdf-import/dto/import-pdf.dto.ts src/pdf-import/pdf-import.service.spec.ts
git commit -m "feat(pdf-import): PdfImportService com ownership, validação e criação do plano"
```

---

### Task 4: Controller, módulo e registro no `AppModule`

**Files:**
- Create: `src/pdf-import/pdf-import.controller.ts`
- Create: `src/pdf-import/pdf-import.module.ts`
- Test: `src/pdf-import/pdf-import.controller.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `PdfImportService.importFromPdf(coachId, dto, pdfBuffer)` (Task 3)
- Produces: rota `POST /training-plans/import-pdf` (multipart/form-data)

- [ ] **Step 1: Escrever o teste de guards/roles do controller (mesmo padrão de `workout-skips.controller.spec.ts`)**

Criar `src/pdf-import/pdf-import.controller.spec.ts`:

```ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PdfImportController } from './pdf-import.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('PdfImportController — guards e roles', () => {
  it('aplica JwtAuthGuard e RolesGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PdfImportController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('importFromPdf() exige role coach', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PdfImportController.prototype.importFromPdf);
    expect(roles).toEqual(['coach']);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npm test -- pdf-import.controller.spec.ts`
Expected: FAIL com "Cannot find module './pdf-import.controller'"

- [ ] **Step 3: Implementar o controller**

Criar `src/pdf-import/pdf-import.controller.ts`:

```ts
import {
  Controller, Post, Body, Request, UseGuards, UseInterceptors,
  UploadedFile, ParseFilePipeBuilder, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PdfImportService } from './pdf-import.service';
import { ImportPdfDto } from './dto/import-pdf.dto';

const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20MB — limite de sanidade de UX, não técnico

@ApiTags('training-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('training-plans')
export class PdfImportController {
  constructor(private readonly service: PdfImportService) {}

  @Roles('coach')
  @Post('import-pdf')
  @ApiOperation({ summary: 'Cria plano de treino rascunho extraindo a estrutura de um PDF via IA' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  importFromPdf(
    @Request() req: any,
    @Body() dto: ImportPdfDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'application/pdf' })
        .addMaxSizeValidator({ maxSize: MAX_PDF_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    return this.service.importFromPdf(req.user.id, dto, file.buffer);
  }
}
```

- [ ] **Step 4: Implementar o módulo**

Criar `src/pdf-import/pdf-import.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PdfImportController } from './pdf-import.controller';
import { PdfImportService } from './pdf-import.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';

@Module({
  controllers: [PdfImportController],
  providers: [PdfImportService, AnthropicExtractionService],
})
export class PdfImportModule {}
```

- [ ] **Step 5: Registrar o módulo em `app.module.ts`**

Em `src/app.module.ts`, adicionar o import:

```ts
import { PdfImportModule } from './pdf-import/pdf-import.module';
```

E adicionar `PdfImportModule` na lista de `imports`, logo após `NotificationsModule`:

```ts
    NotificationsModule,
    PdfImportModule,
```

- [ ] **Step 6: Rodar o teste do controller e o build completo**

Run: `npm test -- pdf-import.controller.spec.ts`
Expected: PASS (2 testes)

Run: `npm run build`
Expected: build limpo, sem erro de tipo

- [ ] **Step 7: Rodar a suíte completa do backend**

Run: `npm test`
Expected: todos os testes passando (suíte anterior + os novos desta feature)

- [ ] **Step 8: Commit**

```bash
git add src/pdf-import/pdf-import.controller.ts src/pdf-import/pdf-import.module.ts src/pdf-import/pdf-import.controller.spec.ts src/app.module.ts
git commit -m "feat(pdf-import): controller, módulo e registro no AppModule"
```

---

## Frontend (`aevonfit-front`)

### Task 5: `ApiService.importPlanFromPdf()`

**Files:**
- Modify: `src/app/core/services/api.service.ts`

**Interfaces:**
- Produces: `ApiService.importPlanFromPdf(studentId: string, startDate: string, file: File): Observable<{ id: string }>` — usado pelo `CoachShellComponent` na Task 6

- [ ] **Step 1: Adicionar o método**

Em `src/app/core/services/api.service.ts`, logo depois do método `createPlan` (perto da linha 223), adicionar:

```ts
  /** Cria plano de treino a partir de um PDF, via extração por IA (rascunho, não publicado) */
  importPlanFromPdf(studentId: string, startDate: string, file: File): Observable<{ id: string }> {
    const formData = new FormData();
    formData.append('studentId', studentId);
    formData.append('startDate', startDate);
    formData.append('file', file);
    return this.http.post<{ id: string }>(`${this.base}/training-plans/import-pdf`, formData);
  }
```

Nenhum outro import novo é necessário — `FormData` é global do browser, `HttpClient` já está injetado na classe.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/app/core/services/api.service.ts
git commit -m "feat(pdf-import): ApiService.importPlanFromPdf"
```

---

### Task 6: `CoachShellComponent` — modo de importação por PDF

**Files:**
- Modify: `src/app/layout/coach-shell/coach-shell.component.ts`

**Interfaces:**
- Consumes: `ApiService.importPlanFromPdf(studentId, startDate, file)` (Task 5)
- Produces: `newPlanMode` (signal), `selectedPdfFile` (signal), `importing` (signal), `onPdfFileSelected(event)`, `importPlanFromPdf()` — usados pelo template na Task 7

- [ ] **Step 1: Adicionar os signals novos**

Em `src/app/layout/coach-shell/coach-shell.component.ts`, logo depois de `saving = signal(false);` (linha ~26), adicionar:

```ts
  newPlanMode = signal<'manual' | 'pdf'>('manual');
  selectedPdfFile = signal<File | null>(null);
  importing = signal(false);
```

- [ ] **Step 2: Resetar o modo novo em `openModal()`**

Em `openModal()`, dentro do método já existente, adicionar as duas linhas abaixo logo depois de `this.form.reset(...)`:

```ts
  openModal(): void {
    this.existingPlansForStudent.set([]);
    this.computedMonth.set(1);
    this.form.reset({ studentId: '', title: 'Mesociclo 1', startDate: '' });
    this.newPlanMode.set('manual');
    this.selectedPdfFile.set(null);
    // reset() acima dispara valueChanges do campo startDate, que marcaria
    // startDateTouchedByUser como true — por isso essa flag só é zerada
    // DEPOIS do reset, não antes.
    this.startDateTouchedByUser = false;
    this.showNewPlanModal.set(true);
  }
```

- [ ] **Step 3: Adicionar `onPdfFileSelected` e `importPlanFromPdf`**

Logo depois do método `createPlan()` (antes de `private showToast`), adicionar:

```ts
  onPdfFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedPdfFile.set(input.files?.[0] ?? null);
  }

  importPlanFromPdf(): void {
    const studentId = this.form.get('studentId')!.value as string;
    const startDate = this.form.get('startDate')!.value as string;
    const file = this.selectedPdfFile();
    if (!studentId || !startDate || !file) {
      this.showToast('Selecione o aluno, a data de início e o arquivo PDF.');
      return;
    }

    this.importing.set(true);
    this.api.importPlanFromPdf(studentId, startDate, file).subscribe({
      next: plan => {
        this.importing.set(false);
        this.closeModal();
        this.showToast('Plano importado do PDF! Revise e publique quando estiver pronto.');
        this.router.navigate(['/coach/plan-builder', studentId], {
          queryParams: { planId: plan.id },
        });
      },
      error: (err) => {
        this.importing.set(false);
        const message = err?.status === 422
          ? 'Não consegui extrair um treino válido desse PDF — tente outro arquivo ou crie manualmente.'
          : 'Erro ao importar o PDF. Tente novamente.';
        this.showToast(message, 5000);
      },
    });
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add src/app/layout/coach-shell/coach-shell.component.ts
git commit -m "feat(pdf-import): CoachShellComponent — modo de importação por PDF"
```

---

### Task 7: Template do modal — toggle e campo de arquivo

**Files:**
- Modify: `src/app/layout/coach-shell/coach-shell.component.html`

**Interfaces:**
- Consumes: `newPlanMode`, `selectedPdfFile`, `importing`, `onPdfFileSelected(event)`, `importPlanFromPdf()` (Task 6)

O arquivo hoje (`coach-shell.component.html:91-179`) tem esta estrutura pro modal (reproduzida aqui por completo pra referência exata dos steps abaixo):

```html
      <!-- Header -->
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="font-headline font-black text-xl text-on-surface tracking-tighter">Novo Treino</h3>
          <p class="text-outline text-xs mt-0.5">Cria um plano mensal para o atleta.</p>
        </div>
        <button type="button" (click)="closeModal()"
          class="w-8 h-8 rounded-sm bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <form [formGroup]="form" (ngSubmit)="createPlan()" novalidate>

        <!-- Atleta -->
        <div class="mb-4">
          ... (campo studentId, sem mudança) ...
        </div>

        <!-- Data de Início + Título lado a lado -->
        <div class="grid grid-cols-[140px_1fr] gap-3 mb-6">
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Data de Início *
            </label>
            <input formControlName="startDate" type="date"
              title="Data de início do mesociclo (ajustada pra Segunda-feira da semana)"
              class="w-full bg-surface-container text-on-surface rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('startDate')?.invalid && form.get('startDate')?.touched) {
              <p class="text-error text-[10px] mt-1">Obrigatório.</p>
            }
          </div>
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Título do Plano *
            </label>
            <input formControlName="title" type="text"
              placeholder="Ex: Mês 1 — Base de Força"
              class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('title')?.invalid && form.get('title')?.touched) {
              <p class="text-error text-xs mt-1">Título obrigatório.</p>
            }
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-3">
          <button type="button" (click)="closeModal()"
            class="flex-1 py-3 rounded-sm border border-outline-variant/30 text-on-surface-variant hover:text-on-surface font-headline text-xs uppercase tracking-wider transition-all">
            Cancelar
          </button>
          <button type="submit" [disabled]="saving()"
            class="flex-1 py-3 rounded-sm bg-primary-fixed hover:bg-primary-dim disabled:opacity-60 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter transition-all flex items-center justify-center gap-2">
            @if (saving()) {
              <span class="material-symbols-outlined text-[16px]">progress_activity</span>
            } @else {
              <span class="material-symbols-outlined text-[16px]">add</span>
            }
            {{ saving() ? 'Criando...' : 'Criar Plano' }}
          </button>
        </div>

      </form>
```

- [ ] **Step 1: Adicionar o toggle logo abaixo do header do modal, e tirar o `(ngSubmit)` do form**

Substituir:

```html
      <form [formGroup]="form" (ngSubmit)="createPlan()" novalidate>

        <!-- Atleta -->
```

por:

```html
      <div class="flex bg-surface-container rounded-sm p-1 mb-4">
        <button type="button"
          (click)="newPlanMode.set('manual')"
          class="flex-1 py-2 rounded-sm text-[11px] font-headline font-bold uppercase tracking-wider transition-all duration-200"
          [class.bg-primary-fixed]="newPlanMode() === 'manual'"
          [class.text-on-primary-fixed]="newPlanMode() === 'manual'"
          [class.text-outline]="newPlanMode() !== 'manual'">
          Criar Vazio
        </button>
        <button type="button"
          (click)="newPlanMode.set('pdf')"
          class="flex-1 py-2 rounded-sm text-[11px] font-headline font-bold uppercase tracking-wider transition-all duration-200"
          [class.bg-primary-fixed]="newPlanMode() === 'pdf'"
          [class.text-on-primary-fixed]="newPlanMode() === 'pdf'"
          [class.text-outline]="newPlanMode() !== 'pdf'">
          Importar PDF
        </button>
      </div>

      <form [formGroup]="form" novalidate>

        <!-- Atleta -->
```

(`(ngSubmit)="createPlan()"` sai do form porque o botão de confirmar, no Step 3 abaixo, passa a chamar `createPlan()` ou `importPlanFromPdf()` explicitamente por `(click)`, cobrindo os dois modos — deixar o `ngSubmit` também disparando `createPlan()` criaria um caminho duplo/inconsistente no modo PDF.)

- [ ] **Step 2: Esconder o campo Título no modo PDF e adicionar o campo de arquivo**

Substituir o bloco inteiro "Data de Início + Título lado a lado":

```html
        <!-- Data de Início + Título lado a lado -->
        <div class="grid grid-cols-[140px_1fr] gap-3 mb-6">
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Data de Início *
            </label>
            <input formControlName="startDate" type="date"
              title="Data de início do mesociclo (ajustada pra Segunda-feira da semana)"
              class="w-full bg-surface-container text-on-surface rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('startDate')?.invalid && form.get('startDate')?.touched) {
              <p class="text-error text-[10px] mt-1">Obrigatório.</p>
            }
          </div>
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Título do Plano *
            </label>
            <input formControlName="title" type="text"
              placeholder="Ex: Mês 1 — Base de Força"
              class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('title')?.invalid && form.get('title')?.touched) {
              <p class="text-error text-xs mt-1">Título obrigatório.</p>
            }
          </div>
        </div>
```

por:

```html
        <!-- Data de Início + Título lado a lado (Título só no modo manual — no modo PDF o título vem da IA) -->
        <div [class]="newPlanMode() === 'manual' ? 'grid grid-cols-[140px_1fr] gap-3 mb-6' : 'grid grid-cols-1 gap-3 mb-6'">
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Data de Início *
            </label>
            <input formControlName="startDate" type="date"
              title="Data de início do mesociclo (ajustada pra Segunda-feira da semana)"
              class="w-full bg-surface-container text-on-surface rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('startDate')?.invalid && form.get('startDate')?.touched) {
              <p class="text-error text-[10px] mt-1">Obrigatório.</p>
            }
          </div>
          @if (newPlanMode() === 'manual') {
            <div>
              <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
                Título do Plano *
              </label>
              <input formControlName="title" type="text"
                placeholder="Ex: Mês 1 — Base de Força"
                class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-3 text-sm"/>
              @if (form.get('title')?.invalid && form.get('title')?.touched) {
                <p class="text-error text-xs mt-1">Título obrigatório.</p>
              }
            </div>
          }
        </div>

        @if (newPlanMode() === 'pdf') {
          <div class="mb-6">
            <label class="block text-on-surface-variant text-[10px] mb-1.5 tracking-widest uppercase font-headline">Arquivo PDF *</label>
            <input type="file" accept="application/pdf" (change)="onPdfFileSelected($event)"
              class="w-full text-on-surface text-sm file:mr-3 file:py-2 file:px-4 file:rounded-sm file:border-0 file:bg-surface-container file:text-on-surface-variant file:text-xs file:uppercase file:font-headline file:font-bold" />
            <p class="text-outline text-[10px] mt-1.5">Pode levar até 1 minuto pra processar. A IA cria um rascunho — você revisa e publica depois.</p>
          </div>
        }
```

- [ ] **Step 3: Trocar o botão "Criar Plano" pra cobrir os dois modos**

Substituir:

```html
          <button type="submit" [disabled]="saving()"
            class="flex-1 py-3 rounded-sm bg-primary-fixed hover:bg-primary-dim disabled:opacity-60 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter transition-all flex items-center justify-center gap-2">
            @if (saving()) {
              <span class="material-symbols-outlined text-[16px]">progress_activity</span>
            } @else {
              <span class="material-symbols-outlined text-[16px]">add</span>
            }
            {{ saving() ? 'Criando...' : 'Criar Plano' }}
          </button>
```

por:

```html
          <button type="button"
            [disabled]="saving() || importing()"
            (click)="newPlanMode() === 'manual' ? createPlan() : importPlanFromPdf()"
            class="flex-1 py-3 rounded-sm bg-primary-fixed hover:bg-primary-dim disabled:opacity-60 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter transition-all flex items-center justify-center gap-2">
            @if (saving() || importing()) {
              <span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            } @else {
              <span class="material-symbols-outlined text-[16px]">add</span>
            }
            {{ importing() ? 'Processando PDF...' : (saving() ? 'Criando...' : (newPlanMode() === 'manual' ? 'Criar Plano' : 'Importar e Criar Rascunho')) }}
          </button>
```

- [ ] **Step 4: Verificação manual via Chrome headless/CDP**

Rodar os dois apps localmente (`npm run start:dev` no backend, `npx ng serve` no frontend), logar como coach, abrir "Novo Treino", alternar entre os dois modos e confirmar visualmente:
- Modo "Criar Vazio" continua funcionando exatamente como antes (regressão zero)
- Modo "Importar PDF" mostra o campo de arquivo, esconde o campo de título manual
- Selecionar um PDF e confirmar mostra o estado "Processando PDF..." até a resposta voltar

- [ ] **Step 5: Commit**

```bash
git add src/app/layout/coach-shell/coach-shell.component.html
git commit -m "feat(pdf-import): template do modal — toggle e campo de arquivo"
```

---

### Task 8: Verificação end-to-end com o PDF real do Mesociclo 6

**Files:** nenhum arquivo novo — task de verificação manual, não de código.

- [ ] **Step 1: Configurar a chave de API real no `.env` local**

Adicionar `ANTHROPIC_API_KEY` real no `.env` do backend local (não commitar).

- [ ] **Step 2: Rodar o fluxo completo com o PDF real**

Com os dois servidores locais rodando e logado como o coach Luan, usar o PDF real já usado como referência nesta sessão (`~/Downloads/Gustavo Henrique Meinhardt Karnopp - Mesociclo 6 planilha.pdf`, ou peça pro usuário caso não esteja mais disponível) — abrir "Novo Treino" → "Importar PDF" → aluno Gustavo → data de início qualquer → confirmar.

- [ ] **Step 3: Conferir a extração**

Abrir o plano criado no plan-builder e comparar visualmente contra a importação manual já feita anteriormente (mesmo PDF, `backend/scripts/import-mesociclo-gustavo.ts`) — número de semanas/dias/sessões bate, exercícios com sets/reps/carga fazendo sentido, nenhum dado obviamente inventado.

- [ ] **Step 4: Deletar o plano de teste criado nesta verificação**

Esse plano é só de verificação — apagar pelo próprio plan-builder (ou via Prisma Studio) antes de considerar a feature pronta, pra não deixar lixo no banco de dev.

- [ ] **Step 5: Reportar o resultado**

Documentar (na revisão final da branch, ou na memória do projeto) se a extração ficou fiel o suficiente, e qualquer ajuste de prompt que tenha sido necessário no `AnthropicExtractionService` durante essa verificação.
