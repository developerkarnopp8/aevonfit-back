import { Test } from '@nestjs/testing';
import { AnthropicExtractionService } from './anthropic-extraction.service';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
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
