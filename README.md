# QoE HFC — K17.2 em homologação

Correção isolada autorizada: referência do acompanhamento = data/hora do registro em tratativas.criado_em. Retira confirmação manual em Gestão/Portal, preserva aprovação separada e sete dias reais consecutivos >=80. Qualquer leitura diária posterior <80 retorna ao mesmo técnico.

Aplicação sobre K17.1 instalada: veja 02_APLICAR_E_CONFERIR.txt. Executar somente o SQL incremental 01_SUPABASE_K17_2.sql, depois publicar os dois HTMLs manualmente. Produção não alterada nesta entrega.

A geração continua na K16.2 congelada + evoluções preservadas (baseline/). python3 build.py recompõe os HTMLs. npm install e npm test executam testes. As fixtures de banco são simulação local, não o banco de produção. O SQL 00_PRE_REQUISITO_K17_1.sql é usado nos testes, não deve ser reaplicado em produção já atualizada.

39 verificações SQL e 11 testes JSDOM passaram no ambiente local, incluindo Excel real. Arquivo privado de Excel não incluído; seu teste é pulado se ausente. Nenhuma homologação online presumida.
