# QoE HFC — Gestão mensal K18.0

Evolução estrutural autorizada pelo gestor em 10/11/2026: distribuição e cobrança mensais a partir de novembro, com pendências herdadas + novas portas manuais, sem quantidade fixa. Migração não cria nem redistribui demandas. Histórico semanal permanece consultável.

Aplicar sobre K17.1: leia `03_APLICAR_E_CONFERIR.txt`. SQL K17.2 primeiro (data do registro), SQL mensal K18 depois, então os dois HTMLs. Não publicar HTML se o SQL falhar. A versão está em homologação; produção não foi alterada nesta entrega.

## Fontes e geração

`baseline/k16_2.html` é a base congelada. `baseline/evolucoes_preservadas.json` recompõe as evoluções publicadas com hashes de origem. `build_k172.py` preserva o fluxo aprovado da data do registro e as integrações; `build.py` aplica a evolução mensal. `monthly_client.js` e `monthly_summary.js` contêm o novo período. Não gera código a partir de HTML com erro.

`python3 build.py` gera Gestão e Portal. `npm install` e `npm test` executam o conjunto. `00_PRE_REQUISITO_K17_1.sql` serve de fixture de instalação nos testes; não deve ser reaplicado em uma produção K17.1 existente.

## Validação

79 verificações SQL e 16 testes JSDOM passaram localmente, incluindo Excel real de 4058 portas/48288 leituras. O Excel e seu JSON privado não integram o repositório; o teste do arquivo real é pulado se não estiver disponível (`QOE_REAL_EXCEL`). Não houve teste autenticado no Supabase/Cloudflare de produção. Homologação continua pendente.

Novembro é uma consolidação de pendências e registros conhecidos, não uma reconstrução inventada de eventos ausentes. A migração mantém os dados originais, sinaliza demandas duplicadas e separa registro, validação e resultado. Pendências após retorno usam a mesma demanda/técnico. Os resultados podem amadurecer após fechamento; recebimentos encerrados são preservados.
