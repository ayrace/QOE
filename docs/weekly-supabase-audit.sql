-- Diagnóstico SOMENTE LEITURA. Não cria tabelas, não altera funções ou dados.
-- Executar no projeto qmbzmccyaaeohcmnudre antes de decidir qualquer migração.
begin read only;

-- Estruturas existentes que podem já persistir o controle semanal.
select table_schema, table_name, column_name, data_type, udt_name
from information_schema.columns
where table_schema='public'
  and (table_name in ('demandas','tratativas','historico','qoe_base_diaria',
                     'gestores','gestor_usuarios')
       or table_name ilike '%seman%' or table_name ilike '%weekly%')
order by table_name, ordinal_position;

-- Contratos das RPCs existentes. qoe_gestor_atual deve permanecer UUID.
select n.nspname as schema_name,p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_function_result(p.oid) as retorno,p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and
 (p.proname in ('qoe_gestor_atual','gestao_snapshot','gestao_alocar',
   'gestao_retirar','gestao_validar_atuacao','gestao_devolver_tratamento',
   'gestao_ler_base_diaria','gestao_salvar_base_diaria')
  or p.proname ilike '%seman%' or p.proname ilike '%weekly%')
order by p.proname;

-- Dimensão do histórico sem expor nomes, tokens ou detalhes das atuações.
select semana,status,count(*) as demandas
from public.demandas group by semana,status order by semana,status;

-- Eventos disponíveis para reconstrução do recebimento sem alterar vínculos.
select evento,count(*) as eventos
from public.historico group by evento order by evento;

rollback;
