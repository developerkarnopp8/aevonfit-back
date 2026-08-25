<!--
Copie este arquivo para .github/pull_request_template.md em cada repositório.
Ele preenche automaticamente a descrição de todo PR novo aberto no GitHub.
-->

## O que mudou

<!-- Descreva a mudança em 1-3 frases. O que foi feito, não como (o diff já mostra o como). -->

## Por quê

<!-- Contexto: qual problema isso resolve, ou qual funcionalidade isso entrega. Link de issue/task se houver. -->

## Como testar

<!-- Passo a passo para quem for revisar conseguir validar localmente. -->

1.
2.
3.

## Screenshots (se houver mudança visual)

<!-- Antes/depois, se aplicável. Apagar esta seção se não houver mudança de UI. -->

## Checklist

- [ ] Testes passam localmente
- [ ] Lint sem erros
- [ ] Nenhum segredo/credencial no diff
- [ ] Self-review feito
- [ ] Se mexeu em migration de banco: testada em ambiente descartável e é reversível (ou o risco foi assumido conscientemente)
- [ ] Se mexeu em autenticação/autorização: revisão extra dedicada a isso

## Risco desta mudança

<!-- Marque uma opção -->
- [ ] Baixo (ajuste isolado, sem impacto em fluxo crítico)
- [ ] Médio (toca em funcionalidade usada, mas não crítica)
- [ ] Alto (toca em autenticação, pagamento, dados sensíveis, ou infraestrutura)
