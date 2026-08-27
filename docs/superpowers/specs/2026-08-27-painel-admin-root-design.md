# Painel de Administração (root/admin) — Design

## Objetivo

Dar ao dono do sistema (usuário) um papel novo, `admin`, com um painel
próprio pra: criar contas de coach, resetar senha de qualquer coach, e
ligar/desligar a feature de importação de PDF via IA por coach
individual. Junto, resolver dois problemas reais achados na sessão de
hoje: (1) quando a API da Anthropic fica sem crédito, a falha some
atrás de um erro genérico — ninguém sabe o motivo real; (2) o coach
não tem como saber se um erro de importação é culpa do PDF dele ou do
sistema.

## Motivação

Hoje só existem os papéis `coach` e `athlete`. Toda gestão de conta
(criar coach, resetar senha) é feita manualmente via script/Prisma
Studio pelo desenvolvedor — não escala e não dá autonomia pro dono do
negócio. E o achado de hoje (conta Anthropic sem crédito, descoberto
só isolando a chamada à API fora do Nest) mostrou que não existe
nenhum canal pra saber, em produção, que a IA parou de funcionar.

## Fora de escopo (YAGNI, registrar como possível v2)

- Editar/deletar conta de coach (só criar + resetar senha + ligar/
  desligar IA nesta v1).
- Gestão de contas de atleta pelo admin (continuam sendo criadas
  pelos próprios coaches, fluxo já existente).
- Envio de e-mail/WhatsApp pro admin (decisão do usuário: reusar o
  sino de notificação já existente, sem infra nova).
- Métricas/dashboard de uso agregado (quantos PDFs importados, etc.) —
  só a lista de coaches com status da flag.
- Múltiplos níveis de admin (só um papel `admin`, sem granularidade
  de permissão dentro dele).

## Arquitetura

### Papel novo

`Role` (enum Prisma) ganha o valor `admin`, junto de `coach`/
`athlete` já existentes — migration puramente aditiva (Postgres
permite adicionar valor a enum sem quebrar dado existente).

### Backend — módulo novo `src/admin/`

Segue a mesma estrutura flat já usada em todo o backend
(`controller` → `service` → `PrismaService`, sem repository
separado). Todas as rotas atrás de `@Roles('admin')` +
`JwtAuthGuard` + `RolesGuard` (mesmo padrão já usado em toda rota
restrita do projeto).

| Rota | O que faz |
|---|---|
| `GET /admin/coaches` | Lista todos os coaches (nome, email, `aiImportEnabled`, `createdAt`) |
| `POST /admin/coaches` | Cria coach novo — nome + e-mail, senha forte gerada na hora (mesmo padrão de `scripts/seed-production.ts`, `crypto.randomBytes`), devolvida uma única vez na resposta |
| `POST /admin/coaches/:id/reset-password` | Gera senha nova forte pro coach, devolvida uma única vez na resposta |
| `PATCH /admin/coaches/:id` | Liga/desliga `aiImportEnabled` |

**Geração de senha**: reusa a mesma função já escrita em
`scripts/seed-production.ts` (`crypto.randomBytes(18).toString('base64url')`)
— extraída pra um helper compartilhado em vez de duplicada, já que
agora tem dois lugares usando o mesmo padrão.

### `aiImportEnabled` no `User`

Campo novo `aiImportEnabled Boolean @default(true)` — migration
aditiva. Default `true` significa que nenhum coach existente (o
Luan) perde acesso à feature quando essa migration rodar; só
desliga quando o admin desligar explicitamente. Só é lido/checado
pra usuários com `role: 'coach'` (atletas não têm essa flag,
irrelevante pra eles).

### Frontend — `AdminShellComponent` novo

Mesmo padrão de `CoachShellComponent`/`AthleteShellComponent`
(componente de layout com sidebar simples + `router-outlet`). Rotas
novas em `app.routes.ts`:

```
/admin/coaches   → lista + criar + resetar senha + toggle da flag
```

Guard novo `adminGuard` (mesmo arquivo `auth.guard.ts`, mesmo padrão
de `coachGuard`/`athleteGuard`): `auth.isAdmin()` novo em
`AuthService`, mesma forma que `isCoach()`/`isAthlete()` já
existem.

**Tela `/admin/coaches`**: tabela com todos os coaches (nome, e-mail,
toggle visual de `aiImportEnabled`, data de criação) + botão "+ Novo
Coach" (abre formulário simples: nome + e-mail) + botão "Resetar
senha" por linha (com confirmação antes — ação destrutiva, invalida
a senha atual). Depois de criar coach ou resetar senha, a senha
gerada aparece uma única vez numa caixa de destaque com aviso pra
copiar agora (mesmo espírito do que já foi feito manualmente no
terminal pro seed de produção, só que numa tela) — não fica
reexibível depois, o backend nunca persiste em texto puro.

**Tela de login ganha um terceiro toggle, "Admin"**, ao lado de
"Coach"/"Atleta" — achado técnico importante: hoje
`AuthService.login()` recebe o papel *esperado* do toggle
selecionado e **bloqueia o login no client** se o papel real
devolvido pela API não bater (`"Este e-mail pertence a um
atleta..."`). Sem um terceiro toggle, uma conta admin nunca
conseguiria logar (nem "Coach" nem "Atleta" bateria). Não tem como
evitar expor que existe um papel "Admin" na tela pública de login —
aceitável, é só rótulo, o acesso continua protegido por credencial
real.

### Bootstrap do primeiro admin

Problema do ovo e da galinha: pra criar coach pelo painel, precisa
de uma conta admin; a primeira conta admin não pode vir do próprio
painel. Um script novo, mesmo padrão de `seed-production.ts`
(`scripts/create-first-admin.ts`), roda uma única vez (local e depois
em produção) e cria a conta admin do próprio usuário, com senha forte
gerada na hora — idempotente por e-mail, igual ao script de seed de
produção.

## Diferenciação de erro pro coach na importação de PDF

Hoje `PdfImportService.validateExtraction()` lança
`UnprocessableEntityException` (422) quando a IA não extrai nenhuma
semana válida, e `extractWithErrorHandling()` lança
`BadGatewayException` (502) genérico pra **qualquer outra** falha —
rede, truncamento, crédito esgotado, etc. — todas com a mesma
mensagem "Erro ao processar o PDF, tente novamente."

Passa a existir uma terceira categoria: falhas de **sistema**
(diferente de "PDF ruim") ganham uma exceção própria
(`ServiceUnavailableException`, 503) com mensagem clara: *"Erro no
sistema de importação — nossa equipe já foi avisada. Tente novamente
mais tarde ou entre em contato com o suporte."* O frontend distingue
os três casos (422 já distinguido hoje; 503 novo; qualquer outro
status continua com a mensagem genérica de fallback já existente).

## Notificação de crédito esgotado pro admin

`AnthropicExtractionService.extract()` já deixa qualquer erro
propagar pra quem chama. `PdfImportService.extractWithErrorHandling()`
passa a inspecionar o erro antes de decidir a exceção:

- Se for `instanceof Anthropic.BadRequestError` **e** a mensagem
  contiver `"credit balance"` (case-insensitive) → é crédito
  esgotado. Notifica todos os usuários com `role: 'admin'` (tipo
  novo `ai_credit_exhausted` no `NotificationType` já existente,
  reusando `NotificationsService.create()`) e lança
  `ServiceUnavailableException` com a mensagem de "entre em contato
  com o suporte" pro coach.
- Qualquer outro erro (rede, truncamento por `stop_reason`, etc.) →
  também vira `ServiceUnavailableException` com a mesma mensagem pro
  coach (é problema de sistema do ponto de vista dele), **mas não
  notifica o admin** — só o caso de crédito exige ação humana
  específica (adicionar fundo); os outros são transitórios.

**Sem duplicar notificação**: antes de criar uma notificação nova de
`ai_credit_exhausted`, confere se já existe uma não-lida do mesmo
tipo pro mesmo admin — evita inundar o sino se vários coaches
tentarem importar PDF enquanto o crédito ainda está zerado.

## Checagem da flag antes de gastar a chamada paga

`PdfImportService.importFromPdf()` passa a checar
`coach.aiImportEnabled` logo depois da checagem de dono do aluno (e
antes de qualquer chamada à IA) — se `false`, lança
`ForbiddenException` com mensagem clara ("Recurso desativado pra sua
conta — entre em contato com o suporte.") sem gastar nenhuma chamada
paga.

## Segurança

- Toda rota `/admin/*` atrás de `@Roles('admin')` — mesmo padrão já
  usado em todo o resto do projeto.
- Senha gerada com `crypto.randomBytes`, nunca logada nem persistida
  em texto puro (só o hash via bcrypt, mesmo padrão já usado em
  `UsersService`).
- `PATCH /admin/coaches/:id` só aceita o campo `aiImportEnabled` —
  não vira um endpoint genérico de update de usuário (evita
  escalonamento de escopo acidental, ex: admin trocando o próprio
  `role` de outro usuário por engano).

## Testes

TDD nos services novos (`AdminService`, e as mudanças em
`PdfImportService`), seguindo o mesmo padrão já usado no projeto —
mock de `PrismaService`/`NotificationsService`, testes reais de
`class-validator` onde aplicável.

## Migração de banco

Duas mudanças aditivas no `schema.prisma` — `Role` ganha `admin`,
`User` ganha `aiImportEnabled Boolean @default(true)` — geradas via
container-sombra descartável, revisão manual do SQL (sem `DROP`),
aplicadas com `migrate deploy`, seguindo o procedimento já
estabelecido no projeto.
