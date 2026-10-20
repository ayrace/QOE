# K16.4 candidata — correção do controle semanal

Não homologada e não publicar enquanto a persistência compartilhada estiver pendente.

## Problema e alteração

Na Gestão publicada, `newWeek()` incrementa somente um contador local, enquanto
`renderWeeks()` sempre mostra a semana 1. O resumo usa `window.state`, mas o estado
é uma variável lexical `let state`, produzindo totais zerados. O recebimento semanal
é truncado em cinco portas e novas alocações não são adicionadas ao ledger.

Esta candidata corrige o cálculo e o histórico no cliente:

- O ledger determina a semana efetivamente aberta. O contador avançado sem ledger
  fica preservado na cópia local anterior à migração.
- Tabela, resumo e mensagem semanal usam os mesmos dados e a semana selecionada.
- A abertura guarda uma fotografia dos totais da semana encerrada e carrega apenas
  pendências da carteira e atuações aguardando validação, preservando seus status.
- Datas são informadas explicitamente. Para a segunda semana operacional prevista
  em 19/10/2026, informar essa data, mesmo se o teste ocorrer depois.
- Novas portas entram por alocação manual, sem teto ou preenchimento automático.
- Normalização sem atuação não conta produção; atuação anterior impede que uma
  nota boa retire a porta do fluxo pós-ação.
- Falha ao gravar a abertura não altera parcialmente o estado da semana.

## Origem e preservação

Base congelada K16.2: blob `b760e2beb58c3c9e88e43e293b0a60da0cab0c03`.
Preservada a exibição de histórico de atuação da publicação K16.3, commit
`184d28a9f77bc529df318e5020f0caca3a0b27fa`, blob
`5378782de33bfdc8aaf7aba1d75a63e3695659bd`.

Nenhuma alteração em `portal.html`, login, credenciais, RPCs, schema, algoritmos de
oscilação, monitoramento, retorno ao tratamento, estabilização ou recorrência.
O backup local da migração é uma salvaguarda do navegador; não substitui um backup
compartilhado. Não foram fechadas demandas nem iniciada uma semana real em produção.

## Bloqueio para publicação

O controle semanal ainda é local no código existente. Corrigir apenas a interface
não garante que outro computador ou gestor veja a mesma semana. Não foi aplicado
schema novo: o acesso ao painel Supabase exige autenticação, cuja solicitação foi
interrompida. As fontes SQL históricas não comprovam o schema atualmente instalado.

Próximo trabalho necessário:

1. Conferir o schema e as RPCs instaladas com `weekly-supabase-audit.sql`.
2. Reconciliar o recebimento da semana 1 com demandas e eventos já existentes,
   incluindo encerradas e normalizações sem atuação. O snapshot ativo sozinho
   não contém o histórico completo e não basta para essa reconstrução.
3. Reutilizar a persistência semanal existente, se houver. Caso não exista, preparar
   a menor integração necessária com gravação atômica, controle de concorrência e
   preservação dos registros históricos. Não armazenar o ledger no JSON da base
   diária sem proteção: o salvamento diário atualmente substitui esse JSON.
4. Carregar a semana compartilhada antes de renderizar ou distribuir, atualizar
   recebimentos e validações no servidor, impedir duplicidade de abertura e testar
   dois gestores/computadores. Não publicar esta candidata como solução completa.

## Verificação realizada

`node --test tests/weekly.test.cjs`

Doze testes passaram: recuperação do contador, preservação de histórico/carteira,
Marco 0 com 65 portas, adição sem limite, normalização antes da atuação, validação
sem duplicidade, abertura e fotografia histórica, cinco pendentes mais duas novas,
recorrência, retirada/monitoramento fora da nova carteira, falha de armazenamento,
seleção de semana/totais e compilação dos scripts executáveis.

Não foi feita regressão online autenticada. Antes da publicação, conferir login,
técnicos, carteira, distribuição, retirada, tratamento, oscilantes, atuação no portal,
múltiplos endereços, MDU, acompanhamento, leituras pós-ação, retorno, estabilização,
recorrência, histórico/semanas, WhatsApp, atualização diária, Supabase, backup e
Marco 0. Manter K16.2 congelada até a homologação explícita do usuário.

Pendência anterior observada: o HTML referencia `resetWeeklyCount`, `exportBackup`
e `importBackup`, sem definições encontradas nesta fonte. Não foram recriadas nesta
correção; verificar no ambiente antes de declarar a regressão de backup concluída.
