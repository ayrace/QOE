# QoE HFC — K19.0 em homologação

Evolução autorizada: acompanhamento automático após registro de atuação executada, MDU/Indoor em área própria com endereços/direcionamento/execução, retirada da marcação de lista distribuída e aviso exato de retorno por QoE <80.

Aplicar somente sobre K18: `01_SUPABASE_K19_AUTOMATICO_MDU.sql`, então os dois HTMLs. Veja `02_APLICAR_E_CONFERIR.txt`. Não houve escrita no banco nem publicação na main pelo assistente. Homologação online pendente.

## Fontes

Geração reproduzível a partir de K16.2 congelada e evoluções preservadas: `baseline/`, `build_k172.py`, `build_k18.py`, `build.py`. A versão mais recente não foi promovida a base validada automaticamente. `mdu_client.js` contém a integração nova; o SQL preserva a tabela existente de secundárias e adiciona duas projeções privadas, sem alterar usuários, tokens, UUID do gestor ou inventar status de demanda.

`python3 build.py` recompõe Gestão/Portal. `npm install` e `npm test` executam o conjunto. SQLs anteriores são pré-requisitos de fixtures nos testes, não uma instrução de reaplicação em produção.

## Validação

21 testes JSDOM, 50 verificações K19 e 79 verificações SQL anteriores passaram localmente. Excel real foi usado (4058 portas/48288 leituras); os bytes privados não são versionados e o teste é pulado quando o Excel não está disponível (`QOE_REAL_EXCEL`). Não houve regressão autenticada no Supabase/Cloudflare real.

A execução MDU é registrada pela Gestão em nome do atendimento informado, mantendo técnico/demanda de origem. Responsável da equipe fica por endereço. Encaminhamento/apoio não contam como execução; os resultados dependem de leituras diárias posteriores ao registro. Legado MDU sem execução identificada não é encerrado automaticamente. Eventos técnicos de aceite têm modo AUTOMATICO para não confundir com aprovação humana.
