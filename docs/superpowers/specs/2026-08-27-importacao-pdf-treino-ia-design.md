# Importação de Plano de Treino via PDF (IA) — Design

## Objetivo

Hoje o coach só consegue criar um plano de treino de duas formas: digitar tudo
manualmente no plan-builder, ou eu (Claude) ler um PDF de planilha à mão e
escrever um script de import (como foi feito com o Mesociclo 6 do Luan). Essa
feature dá ao coach um jeito de fazer isso sozinho pelo próprio app: envia o
PDF, uma IA extrai a estrutura (semanas/dias/sessões/exercícios), o sistema
cria um **plano rascunho (não publicado)**, e o coach revisa/edita na tela de
plan-builder que já existe antes de publicar. A IA elimina a digitação; a
validação humana continua obrigatória — nada chega ao atleta sem o coach
publicar.

## Motivação

- Coaches recebem planilhas de treino em PDF de fora do sistema (de outro
  coach, de uma plataforma de programação, etc.) e hoje precisam retranscrever
  tudo à mão no plan-builder — trabalho repetitivo e sujeito a erro de
  digitação.
- Já validamos que o formato funciona bem pra extração por IA: o Mesociclo 6
  (12 páginas, tabelas, várias sessões por dia) foi importado com sucesso
  numa sessão anterior, só que manualmente.

## Fora de escopo (feature separada)

O usuário também pediu um papel "root" que cria/gerencia contas de coach,
reseta senha, e liga/desliga a IA por coach. Isso é um subsistema
independente (autorização, gestão de usuário) — vai ser desenhado como uma
spec própria depois desta. Esta feature já nasce preparada pra, no futuro,
checar uma flag "IA habilitada" por coach antes de aceitar o upload — mas
essa checagem em si **não** faz parte desta implementação, porque a flag
ainda não existe em lugar nenhum do schema.

## Arquitetura

**Módulo novo**: `src/pdf-import/` (`pdf-import.module.ts`,
`.controller.ts`, `.service.ts`), seguindo a estrutura flat já usada em todo
o backend. Não mexe em `TrainingPlansService` — este módulo só produz um
`TrainingPlan` completo via `PrismaService` (nested `create`, mesmo padrão já
usado em `prisma/seed.ts` e nos scripts de import anteriores) e reusa
`StudentsService.findOne` pra confirmar que o `studentId` pertence ao coach
autenticado, igual a todo o resto do backend.

**Extração via IA**: dependência nova `@anthropic-ai/sdk`, variável de
ambiente nova `ANTHROPIC_API_KEY` (documentar em `.env.example`, nunca
commitada). O PDF é enviado **direto** pra API da Anthropic como bloco de
documento (suporte nativo — lê texto, tabela e PDF escaneado como imagem,
sem OCR separado) — não extraímos texto antes com uma lib de PDF, porque o
formato real (tabelas, layout livre) quebraria uma extração de texto ingênua.

**Formato da resposta**: a chamada usa *tool use* da API da Anthropic — a
IA é obrigada a responder através de uma ferramenta com schema fixo, não
"responda em JSON" em texto livre. Schema da ferramenta (`extract_training_plan`):

```
{
  planTitle: string,               // sugestão de título extraída do PDF (coach pode editar depois)
  weeks: [{
    weekNumber: number,            // 1, 2, 3...
    days: [{
      dayOfWeek: string,           // "Segunda".."Sábado" — mesmo vocabulário já usado no schema
      dayIndex: number,            // 0-6, mesmo formato já usado em TrainingDay.dayIndex
      sessions: [{
        name: string,
        type: SessionType,         // enum já existente: Mobility|LPO|Strength|Gymnastics|Metcon|Endurance|Core
        order: number,
        exercises: [{
          name: string,
          youtubeUrl?: string,
          sets?: number,
          reps?: string,
          duration?: string,
          restSeconds?: number,
          loadPercent?: number,
          coachNotes?: string,
          order: number
        }]
      }]
    }]
  }]
}
```

**Arquivo do PDF**: processado em memória (`multer` com `memoryStorage`),
nunca persistido em disco/S3 — não tem por que guardar o PDF original; se a
extração falhar o coach só reenvia.

## Mapeamento de data (resolvido, sem trabalho extra pro coach)

`Week` não guarda data própria hoje — a data de cada `TrainingDay` já é
sempre **derivada**: `plan.startDate + (weekNumber-1)×7 + (dayIndex-1)` dias
(mesmo cálculo já usado em `plan-calendar-modal.component.ts` e na
exportação de PDF). O coach só informa a data de início da **Semana 1** (no
mesmo campo que já existe no modal "Novo Treino" hoje); a IA só precisa
identificar corretamente `weekNumber` e `dayIndex` de cada dia do PDF — o
sistema calcula a data real de cada um automaticamente, sem input extra.

## Fluxo ponta a ponta

1. Coach abre o modal "Novo Treino" (já existe, hoje pede aluno + título +
   data de início) — ganha um toggle novo: **Criar vazio** (fluxo atual, sem
   mudança) ou **Importar PDF**.
2. Com "Importar PDF" selecionado: mesmos campos de hoje (aluno já vem do
   contexto, data de início) + campo de arquivo (`accept="application/pdf"`,
   limite 20MB no client e no `multer`).
3. Ao confirmar: `POST /training-plans/import-pdf` (multipart/form-data:
   `studentId`, `startDate`, `file`) — **síncrono**, coach vê um estado de
   carregando na própria tela até terminar (pode levar até ~60s em PDF
   grande, decisão consciente de não construir fila/notificação nesta v1).
4. Backend confirma que `studentId` pertence ao coach (`StudentsService.findOne`),
   manda o PDF pra Anthropic com o schema da ferramenta.
5. Resposta inválida/vazia (nenhuma semana extraída, ou a validação do DTO
   falha) → **nada é criado**, `422` com mensagem clara ("Não consegui
   extrair um treino válido desse PDF — tente outro arquivo ou crie
   manualmente.").
6. Resposta válida → cria o `TrainingPlan` completo (`published: false`) numa
   única chamada Prisma com `create` aninhado (semanas→dias→sessões→
   exercícios, mesmo padrão já usado nos scripts de seed/import existentes —
   Prisma trata isso como uma transação implícita, sem precisar de
   `$transaction` manual).
7. Frontend redireciona o coach direto pro plan-builder daquele plano novo —
   é um plano igual a qualquer outro criado manualmente: os mesmos drawers de
   editar/adicionar exercício, o mesmo botão "Publicar" já existentes. Nada
   de tela de revisão especial — reaproveita 100% da UI que já existe.

## Erros e limites

| Situação | Resposta |
|---|---|
| Arquivo não é PDF | `400` no `multer` (fileFilter por mimetype) |
| Arquivo > 20MB | `400`/`413` no `multer` (limite de sanidade de UX — a API da Anthropic aguenta mais, o limite aqui não é técnico) |
| `studentId` não pertence ao coach | `403` (mesma checagem já usada em `POST /training-plans`) |
| Chamada à API da Anthropic falha (rede, rate limit, etc.) | `502`, "Erro ao processar o PDF, tente novamente." — nada criado |
| IA responde mas sem nenhuma semana/dia válido | `422`, nada criado (ver passo 5 acima) |

## Segurança

- `@Roles('coach')` + `RolesGuard` (mesmo padrão de `POST /training-plans`)
- Ownership do aluno confirmado antes de qualquer chamada à IA (evita gastar
  a chamada paga se o coach nem tem acesso àquele aluno)
- `ANTHROPIC_API_KEY` só no backend, nunca exposta ao frontend
- PDF nunca persistido — reduz superfície de dado sensível em disco

## Testes

- TDD no `PdfImportService`: mock do client da Anthropic (sem chamar a API
  de verdade nos testes automatizados) — cobrir resposta válida (cria plano
  completo), resposta vazia/inválida (nada criado, `422`), erro de rede
  (`502`), aluno de outro coach (`403`, sem chamar a IA).
- Verificação manual com o Mesociclo 6 de verdade (já temos o PDF de
  referência) antes de considerar a feature pronta — comparar a estrutura
  extraída pela IA contra o que já foi importado manualmente naquela sessão
  anterior, como conferência de qualidade real.

## Dependência nova

`@anthropic-ai/sdk` (backend) + `ANTHROPIC_API_KEY` (variável de ambiente,
documentada em `.env.example`, configurada manualmente em produção — não
faz parte do `docker-compose.prod.yml` até este momento, precisa ser
adicionada no `.env` da VPS quando a feature for implementada).
