# QoE HFC K17.1 — candidata para homologação

Ver `02_APLICAR_E_TESTAR.txt`. Produção não foi alterada por esta entrega.

Origem: K16.2 congelada (blob `b760e2beb58c3c9e88e43e293b0a60da0cab0c03`),
reaplicando as evoluções preservadas até o arquivo de Gestão em uso na main
(`643c6b98b38b8c0fd9f81d2ae2c846838aac5ce1`, commit `d894b680cb82388feda73099825abc19e06fb8a7`).
Portal de origem: blob `a576d1c39d95786426a11b43d14df3fbef3961a2`.

`python3 build.py` verifica a base e a composição por SHA-256 e gera os dois HTMLs.
Os candidatos intermediários com falhas de teste não foram publicados; a saída é
regenerada a partir das fontes preservadas.

Testes: Node 24, `npm install`, `npm test`.
O teste de Excel real exige `QOE_REAL_EXCEL` apontando para a extração de referência
`data (8)(1).xlsx`; ela não é publicada neste repositório. O resumo/hash de conferência
está em `tests/real-expected-summary.json`. A bateria SQL usa fixtures locais; a
verificação adicional de volume real é executada se `tests/expected-real.json`
estiver presente, sem publicar os dados reais da extração.

Não usar os SQLs de `tests/fixtures` em produção. A única migração de aplicação
é `01_SUPABASE_K17.sql`, incluída no ZIP como `01_SUPABASE_K17_1.sql`.
