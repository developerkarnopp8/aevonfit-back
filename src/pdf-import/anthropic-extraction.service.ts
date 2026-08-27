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

function requireAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY não configurado — defina a variável de ambiente antes de iniciar a aplicação.',
    );
  }
  return apiKey;
}

@Injectable()
export class AnthropicExtractionService {
  private readonly client = new Anthropic({ apiKey: requireAnthropicApiKey() });
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

  async extract(pdfBuffer: Buffer): Promise<unknown> {
    const finalMessage = await this.client.messages
      .stream({
        model: this.model,
        max_tokens: 32000,
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
      })
      .finalMessage();

    if (finalMessage.stop_reason === 'max_tokens') {
      throw new Error(
        'A extração da IA foi cortada por exceder o limite de tokens — tente um PDF menor ou dividido em partes.',
      );
    }

    const toolUse = finalMessage.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error('A IA não retornou uma extração estruturada (sem bloco tool_use na resposta).');
    }
    return toolUse.input;
  }
}
