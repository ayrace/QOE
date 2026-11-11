-- K19 candidata. Aplicar integralmente sobre K18 instalada.
-- Acompanhamento automático após atuação EXECUTADA + MDU por endereço.
begin;
do $$begin
 if pg_get_function_result('public.qoe_gestor_atual()'::regprocedure)<>'uuid' then raise exception 'Gestor deve retornar UUID';end if;
 perform 'public.gestao_mensal_ler_k18()'::regprocedure;
 perform id,demanda_origem_id,tratativa_origem_id,tipo,endereco,descricao,status,criada_em,atualizada_em from public.demandas_secundarias limit 0;
 if exists(select 1 from pg_attribute where attrelid='public.demandas_secundarias'::regclass and attname='status' and attnotnull and not atthasdef) then raise exception 'demandas_secundarias.status é obrigatório e não tem default. Inspecione a definição antes de aplicar K19.';end if;
 if (to_regclass('public.qoe_registros_k19') is not null or to_regclass('public.qoe_mdu_enderecos_k19') is not null)
 and to_regprocedure('public.gestao_mdu_ler_k19()') is null then raise exception 'Estrutura K19 preexistente sem RPCs conhecidas. Inspecione antes de continuar.';end if;
end $$;
create table if not exists public.qoe_registros_k19 (
 tratativa_id uuid primary key references public.tratativas(id),
 finalidade text not null check(finalidade in ('EXECUTADA','ENCAMINHAMENTO','DEVOLUTIVA')),
 origem text not null,criado_em timestamptz not null default now()
);
create table if not exists public.qoe_mdu_enderecos_k19 (
 id uuid primary key default gen_random_uuid(),
 secundaria_id uuid not null references public.demandas_secundarias(id),
 ordem integer not null check(ordem>0),endereco text not null,
 responsavel text,encaminhada_em timestamptz,
 executada_em timestamptz,descricao_execucao text,tratativa_execucao_id uuid references public.tratativas(id),
 versao integer not null default 1,atualizada_em timestamptz not null default now(),
 unique(secundaria_id,ordem)
);
alter table public.qoe_registros_k19 enable row level security;
alter table public.qoe_mdu_enderecos_k19 enable row level security;
revoke all on public.qoe_registros_k19,public.qoe_mdu_enderecos_k19 from public,anon,authenticated;

create or replace function public.qoe_k19_mdu_sync() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Endereço original fica intacto. Só a projeção por endereço é acrescentada.
 insert into public.qoe_mdu_enderecos_k19(secundaria_id,ordem,endereco)
 select ds.id,x.ordem,case when ds.endereco~'^[[:space:]]*1[.][[:space:]]' then regexp_replace(trim(x.endereco),'^[0-9]+[.][[:space:]]+','') else trim(x.endereco) end
 from public.demandas_secundarias ds cross join lateral (
 select endereco,ordinality::integer ordem from regexp_split_to_table(
 coalesce(ds.endereco,''),case when ds.endereco~'^[[:space:]]*1[.][[:space:]]' then '[[:space:]]+[|][[:space:]]+[0-9]+[.][[:space:]]+' else '$a' end) with ordinality a(endereco,ordinality)
 ) x where upper(ds.tipo) in ('MDU','INDOOR') and nullif(trim(x.endereco),'') is not null
 and not exists(select 1 from public.qoe_registros_k19 reg where reg.tratativa_id=ds.tratativa_origem_id and reg.origem='MDU_GESTAO')
 on conflict(secundaria_id,ordem) do nothing;
end $$;

create or replace function public.qoe_k19_secundaria(p_tratativa uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tratativas;begin
 select * into strict t from public.tratativas where id=p_tratativa;
 if upper(t.tipo_atuacao) not in ('MDU','INDOOR') then return;end if;
 if nullif(trim(coalesce(t.endereco_ofensor,'')),'') is null then raise exception 'Informe ao menos um endereço MDU/Indoor';end if;
 if not exists(select 1 from public.demandas_secundarias where tratativa_origem_id=t.id) then
  -- Status original usa o DEFAULT já existente no banco, sem criar novos status.
  insert into public.demandas_secundarias(id,demanda_origem_id,tratativa_origem_id,tipo,endereco,descricao,criada_em,atualizada_em)
  values(gen_random_uuid(),t.demanda_id,t.id,t.tipo_atuacao,t.endereco_ofensor,t.descricao,clock_timestamp(),clock_timestamp());
 end if;
 perform public.qoe_k19_mdu_sync();
end $$;

-- Implementação privada é preenchida pela geração com o mesmo algoritmo K17.2.
create or replace function public.qoe_k19_processar(p_demanda_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.demandas;c public.qoe_contexto_atuacao;r record;action_day date;prev date;
 seq integer:=0;best integer:=0;bad boolean:=false;end_day date;new_status text;port text;vals jsonb:='[]';
begin

 select * into strict d from public.demandas where id=p_demanda_id for update;
 select x.* into c from public.qoe_contexto_atuacao x join public.tratativas t on t.id=x.tratativa_id
 where t.demanda_id=d.id and x.validada_em is not null and x.decisao='VALIDADA'
 order by t.criado_em desc,t.id desc limit 1;
 if not found or d.status<>'MONITORAMENTO' then return jsonb_build_object('ignorado',true,'status',d.status);end if;
 select criado_em into strict c.atuada_em from public.tratativas where id=c.tratativa_id;
 update public.qoe_contexto_atuacao set atuada_em=c.atuada_em,data_informada=true,origem_data='REGISTRO_PORTAL' where tratativa_id=c.tratativa_id;
 action_day:=(c.atuada_em at time zone 'America/Sao_Paulo')::date;
 select porta into strict port from public.portas_qoe where id=d.porta_id;
 -- O relatório é diário, sem horário: o dia da atuação é excluído por segurança.
 for r in
  select data_leitura,nota from (
   select distinct on(data_leitura) data_leitura,nota from (
    select data_leitura,nota,1 priority from public.qoe_leituras_hfc where porta=port
    union all select data_leitura,nota,2 from public.monitoramento where demanda_id=d.id
   ) a where data_leitura>action_day and data_leitura<=(now() at time zone 'America/Sao_Paulo')::date and nota is not null
   order by data_leitura,priority
  ) b order by data_leitura
 loop
  vals:=vals||jsonb_build_array(jsonb_build_object('data',r.data_leitura,'nota',r.nota));
  if r.nota<80 then bad:=true;seq:=0;end_day:=r.data_leitura;exit;end if;
  if prev is null or r.data_leitura=prev+1 then seq:=seq+1;else seq:=1;end if;
  prev:=r.data_leitura;end_day:=r.data_leitura;
  best:=greatest(best,seq);
 end loop;
 if not bad then seq:=best;end if;
 new_status:=case when bad then 'PENDENTE' when seq>=7 then 'ESTABILIZADA' else 'MONITORAMENTO' end;
 update public.qoe_contexto_atuacao set sequencia=seq,
 resultado=case when bad then 'RETORNO_TRATAMENTO' when seq>=7 then 'ESTABILIZADA' else 'ACOMPANHAMENTO' end,
 concluida_em=case when new_status<>'MONITORAMENTO' then end_day::timestamp at time zone 'America/Sao_Paulo' else null end
 where tratativa_id=c.tratativa_id;
 if new_status<>'MONITORAMENTO' then
  update public.demandas set status=new_status,encerrada_em=case when new_status='ESTABILIZADA' then now() else null end where id=d.id;
  insert into public.historico(porta_id,demanda_id,origem,usuario_nome,evento,detalhes)
  values(d.porta_id,d.id,'SISTEMA','Gestão',case when bad then 'MONITORAMENTO_RETORNO_TRATAMENTO' else 'MONITORAMENTO_ESTABILIZADO' end,
   jsonb_build_object('tratativa_id',c.tratativa_id,'data_atuacao',c.atuada_em,'ultima_data',end_day,'sequencia',seq,'status_novo',new_status,'tecnico_id_mantido',d.tecnico_id,'mensagem',case when bad then 'QoE abaixo de 80 após atuação. Necessário continuar o tratamento.' end));
 end if;
 return jsonb_build_object('status',new_status,'sequencia',seq,'leituras_pos',vals,'tratativa_id',c.tratativa_id,'mensagem',case when bad then 'QoE abaixo de 80 após atuação. Necessário continuar o tratamento.' else 'Atuação registrada. Acompanhamento automático iniciado.' end);
end $$;
create or replace function public.gestao_processar_monitoramento_k17(p_demanda_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.qoe_k17_gestor();return public.qoe_k19_processar(p_demanda_id);end $$;

create or replace function public.qoe_k19_finalizar_registro(p_tratativa uuid,p_finalidade text,p_origem text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tratativas;d public.demandas;f text;outcome jsonb;old_f text;
begin
 select * into strict t from public.tratativas where id=p_tratativa;
 select * into strict d from public.demandas where id=t.demanda_id for update;
 select finalidade into old_f from public.qoe_registros_k19 where tratativa_id=t.id;
 if found then return jsonb_build_object('tratativa_id',t.id,'status',d.status,'finalidade',old_f,'ja_processado',true);end if;
 if d.status not in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA') then raise exception 'Demanda não disponível para novo registro';end if;
 f:=upper(coalesce(p_finalidade,case when upper(t.tipo_atuacao) in ('MDU','INDOOR') then 'ENCAMINHAMENTO' else 'EXECUTADA' end));
 if upper(t.tipo_atuacao) in ('SEM_OPORTUNIDADE','NECESSITA_APOIO') then f:='DEVOLUTIVA';end if;
 if f not in ('EXECUTADA','ENCAMINHAMENTO','DEVOLUTIVA') then raise exception 'Finalidade inválida';end if;
 if f='ENCAMINHAMENTO' and upper(t.tipo_atuacao) not in ('MDU','INDOOR') then raise exception 'Encaminhamento exige MDU/Indoor';end if;
 insert into public.qoe_registros_k19(tratativa_id,finalidade,origem) values(t.id,f,p_origem)
 on conflict(tratativa_id) do nothing;
 select finalidade into old_f from public.qoe_registros_k19 where tratativa_id=t.id;
 if old_f<>f then raise exception 'Registro já possui outra finalidade';end if;
 insert into public.qoe_contexto_atuacao(tratativa_id,atuada_em,data_informada,origem_data)
 values(t.id,t.criado_em,true,'REGISTRO_PORTAL') on conflict(tratativa_id) do nothing;
 if f='ENCAMINHAMENTO' then perform public.qoe_k19_secundaria(t.id);end if;
 if f<>'EXECUTADA' then
  update public.demandas set status='PENDENTE' where id=d.id;
  return jsonb_build_object('tratativa_id',t.id,'status','PENDENTE','finalidade',f,'mensagem',case when f='ENCAMINHAMENTO' then 'Endereços incluídos na fila MDU/Indoor.' else 'Devolutiva registrada. Tratamento permanece pendente.' end);
 end if;
 if upper(t.tipo_atuacao) in ('MDU','INDOOR') then
  if p_origem<>'MDU_GESTAO' then perform public.qoe_k19_secundaria(t.id);else perform public.qoe_k19_mdu_sync();end if;
  update public.qoe_mdu_enderecos_k19 e set executada_em=t.criado_em,descricao_execucao=t.descricao,
  responsavel=coalesce(e.responsavel,(select nome from public.tecnicos where id=d.tecnico_id)),tratativa_execucao_id=t.id
  where secundaria_id in(select id from public.demandas_secundarias where tratativa_origem_id=t.id) and e.executada_em is null;
 end if;
 update public.qoe_contexto_atuacao set validada_em=clock_timestamp(),decisao='VALIDADA' where tratativa_id=t.id;
 update public.demandas set status='MONITORAMENTO',encerrada_em=null where id=d.id;
 -- Evento mantido por compatibilidade. Detalhe distingue aceite automático de aprovação humana.
 insert into public.historico(porta_id,demanda_id,origem,usuario_nome,evento,detalhes)
 values(d.porta_id,d.id,'SISTEMA','Sistema','ATUACAO_VALIDADA',jsonb_build_object('tratativa_id',t.id,'modo','AUTOMATICO','registro_em',t.criado_em));
 outcome:=public.qoe_k19_processar(d.id);
 return outcome||jsonb_build_object('tratativa_id',t.id,'finalidade',f);
end $$;

create or replace function public.portal_tecnico_registrar_atuacao_k19(
 p_token uuid,p_demanda uuid,p_tipo text,p_descricao text,p_endereco text,p_observacao text,p_finalidade text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t uuid;d public.demandas;begin
 select dd.* into d from public.demandas dd join public.tecnicos tc on tc.id=dd.tecnico_id
 where dd.id=p_demanda and tc.ativo and tc.token_acesso=p_token for update of dd;
 if not found then raise exception 'Carteira não autorizada';end if;
 if d.status not in ('PENDENTE','RECORRENTE') then raise exception 'Demanda não disponível para atuação';end if;
 if p_tipo not in ('MANUTENCAO_COAXIAL','MDU','INDOOR','SEM_OPORTUNIDADE','NECESSITA_APOIO','OUTRO') or nullif(trim(coalesce(p_descricao,'')),'') is null then raise exception 'Informe tipo válido e devolutiva';end if;
 if p_tipo in ('MDU','INDOOR') and nullif(trim(coalesce(p_endereco,'')),'') is null then raise exception 'Informe ao menos um endereço MDU/Indoor';end if;
 if exists(select 1 from public.qoe_observacao_carteira where demanda_id=p_demanda) then raise exception 'Porta em observação; solicite nova distribuição';end if;
 update public.demandas set status='PENDENTE' where id=p_demanda;
 t:=public.portal_tecnico_registrar_atuacao(p_token,p_demanda,p_tipo,p_descricao,p_endereco,p_observacao);
 return public.qoe_k19_finalizar_registro(t,p_finalidade,'PORTAL');
end $$;
create or replace function public.portal_tecnico_registrar_atuacao_k17(
 p_token uuid,p_demanda uuid,p_tipo text,p_descricao text,p_endereco text,p_observacao text,p_atuada_em timestamptz)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;begin s:=public.portal_tecnico_registrar_atuacao_k19(p_token,p_demanda,p_tipo,p_descricao,p_endereco,p_observacao,null);return (s->>'tratativa_id')::uuid;end $$;

create or replace function public.gestao_registrar_tratativa_k19(
 p_porta text,p_gestor_nome text,p_tipo text,p_descricao text,p_endereco text,p_observacao text,p_finalidade text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t uuid;d uuid;begin
 perform public.qoe_k17_gestor();
 select dd.id into strict d from public.demandas dd join public.portas_qoe p on p.id=dd.porta_id
 where p.porta=p_porta and dd.status in ('PENDENTE','RECORRENTE') order by dd.criada_em desc limit 1 for update of dd;
 if nullif(trim(coalesce(p_descricao,'')),'') is null then raise exception 'Informe a devolutiva';end if;
 t:=public.gestao_registrar_tratativa(p_porta,p_gestor_nome,p_tipo,p_descricao,p_endereco,p_observacao);
 if d is distinct from (select demanda_id from public.tratativas where id=t) then raise exception 'Há mais de uma demanda ativa para a porta. Confira os conflitos antes de registrar.';end if;
 return public.qoe_k19_finalizar_registro(t,p_finalidade,'GESTAO');
end $$;
create or replace function public.gestao_registrar_tratativa_k17(
 p_porta text,p_gestor_nome text,p_tipo text,p_descricao text,p_endereco text,p_observacao text,p_atuada_em timestamptz)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;begin s:=public.gestao_registrar_tratativa_k19(p_porta,p_gestor_nome,p_tipo,p_descricao,p_endereco,p_observacao,null);return (s->>'tratativa_id')::uuid;end $$;

create or replace function public.gestao_mdu_ler_k19() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;begin
 perform public.qoe_k17_gestor();perform public.qoe_k19_mdu_sync();
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'secundaria_id',ds.id,'demanda_origem_id',ds.demanda_origem_id,'tratativa_origem_id',ds.tratativa_origem_id,
 'porta',p.porta,'node',to_jsonb(p)->>'node','tecnico',tc.nome,'tipo',ds.tipo,'descricao',ds.descricao,'endereco_original',ds.endereco,
 'endereco',e.endereco,'ordem',e.ordem,'responsavel',e.responsavel,'versao',e.versao,'criada_em',ds.criada_em,
 'encaminhada_em',e.encaminhada_em,'executada_em',e.executada_em,'descricao_execucao',e.descricao_execucao,
 'situacao',case when e.executada_em is not null then 'EXECUTADO' when e.encaminhada_em is not null then 'ENCAMINHADO' else 'PENDENTE' end,
 'status_origem',ds.status,'tratativa_execucao_id',e.tratativa_execucao_id) order by ds.criada_em desc,e.ordem),'[]') into s
 from public.qoe_mdu_enderecos_k19 e join public.demandas_secundarias ds on ds.id=e.secundaria_id
 join public.demandas d on d.id=ds.demanda_origem_id join public.portas_qoe p on p.id=d.porta_id left join public.tecnicos tc on tc.id=d.tecnico_id;
 return s;
end $$;

create or replace function public.gestao_mdu_cadastrar_k19(p_demanda uuid,p_tipo text,p_enderecos jsonb,p_descricao text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.demandas;g uuid;gname text;port text;addr text;s jsonb;sec uuid;begin
 g:=public.qoe_k17_gestor();select * into strict d from public.demandas where id=p_demanda for update;
 if d.status not in ('PENDENTE','RECORRENTE') then raise exception 'Selecione uma porta pendente para encaminhamento';end if;
 if exists(select 1 from public.demandas dd where dd.porta_id=d.porta_id and dd.id<>d.id and dd.status in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA','MONITORAMENTO') and not exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=dd.id)) then raise exception 'Há demandas ativas duplicadas. Confira o vínculo de origem antes de cadastrar MDU.';end if;
 if upper(coalesce(p_tipo,'')) not in ('MDU','INDOOR') or nullif(trim(coalesce(p_descricao,'')),'') is null then raise exception 'Informe tipo e descrição';end if;
 if jsonb_typeof(p_enderecos) is distinct from 'array' or jsonb_array_length(p_enderecos)=0 then raise exception 'Informe pelo menos um endereço';end if;
 if exists(select 1 from jsonb_array_elements(p_enderecos) x where jsonb_typeof(x)<>'string' or nullif(trim(x#>>'{}'),'') is null) then raise exception 'Endereço inválido';end if;
 select string_agg(n::text||'. '||trim(x),' | ' order by n) into addr from jsonb_array_elements_text(p_enderecos) with ordinality a(x,n);
 select nome into strict gname from public.gestores where id=g;
 select porta into strict port from public.portas_qoe where id=d.porta_id;
 s:=public.gestao_registrar_tratativa_k19(port,gname,case when upper(p_tipo)='INDOOR' then 'Indoor' else 'MDU' end,p_descricao,addr,null,'ENCAMINHAMENTO');
 select id into strict sec from public.demandas_secundarias where tratativa_origem_id=(s->>'tratativa_id')::uuid order by criada_em limit 1;
 return sec;
end $$;

create or replace function public.gestao_mdu_direcionar_k19(p_endereco uuid,p_responsavel text,p_versao integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.qoe_mdu_enderecos_k19;d public.demandas;begin
 perform public.qoe_k17_gestor();select * into strict e from public.qoe_mdu_enderecos_k19 where id=p_endereco for update;
 if e.versao<>p_versao then raise exception 'Endereço mudou em outro computador. Atualize.';end if;
 if e.executada_em is not null then raise exception 'Execução já registrada';end if;
 if nullif(trim(coalesce(p_responsavel,'')),'') is null then raise exception 'Informe responsável ou equipe';end if;
 update public.qoe_mdu_enderecos_k19 set responsavel=trim(p_responsavel),encaminhada_em=clock_timestamp(),versao=versao+1,atualizada_em=clock_timestamp() where id=e.id;
 select dd.* into d from public.demandas dd join public.demandas_secundarias ds on ds.demanda_origem_id=dd.id where ds.id=e.secundaria_id;
 insert into public.historico(porta_id,demanda_id,origem,usuario_nome,evento,detalhes) values(d.porta_id,d.id,'GESTAO','Gestão','MDU_DIRECIONADO',jsonb_build_object('endereco_id',e.id,'responsavel',p_responsavel,'gestor_id',public.qoe_k17_gestor()));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.gestao_mdu_executar_k19(p_endereco uuid,p_descricao text,p_versao integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.qoe_mdu_enderecos_k19;ds public.demandas_secundarias;d public.demandas;t uuid;remaining integer;g uuid;
begin
 g:=public.qoe_k17_gestor();
 -- A trava da demanda serializa execuções simultâneas de endereços da mesma ocorrência.
 select dd.* into strict d from public.demandas dd join public.demandas_secundarias s on s.demanda_origem_id=dd.id
 join public.qoe_mdu_enderecos_k19 ee on ee.secundaria_id=s.id where ee.id=p_endereco for update of dd;
 select * into strict e from public.qoe_mdu_enderecos_k19 where id=p_endereco for update;
 if e.versao<>p_versao then raise exception 'Endereço mudou em outro computador. Atualize.';end if;
 if e.executada_em is not null then return jsonb_build_object('ok',true,'ja_executado',true);end if;
 if nullif(trim(coalesce(p_descricao,'')),'') is null or e.responsavel is null then raise exception 'Informe responsável e descrição da execução';end if;
 select * into strict ds from public.demandas_secundarias where id=e.secundaria_id;
 update public.qoe_mdu_enderecos_k19 set executada_em=clock_timestamp(),descricao_execucao=trim(p_descricao),versao=versao+1,atualizada_em=clock_timestamp() where id=e.id;
 insert into public.historico(porta_id,demanda_id,origem,usuario_nome,evento,detalhes) values(d.porta_id,d.id,'GESTAO','Gestão','MDU_EXECUCAO_REGISTRADA',jsonb_build_object('endereco_id',e.id,'responsavel',e.responsavel,'descricao',p_descricao,'gestor_id',g));
 select count(*) into remaining from public.qoe_mdu_enderecos_k19 ee join public.demandas_secundarias s on s.id=ee.secundaria_id
 where s.demanda_origem_id=d.id and ee.executada_em is null;
 if remaining>0 then return jsonb_build_object('ok',true,'pendentes',remaining,'mensagem','Execução registrada. Ainda há endereços pendentes.');end if;
 if d.status not in ('PENDENTE','RECORRENTE') then return jsonb_build_object('ok',true,'mensagem','Execução registrada. A porta mantém o fluxo atual; não foi reaberta nem reiniciada.');end if;
 -- Registra a conclusão da ocorrência na mesma demanda, mantendo o técnico de origem.
 insert into public.tratativas(demanda_id,tipo_atuacao,descricao,endereco_ofensor,observacao)
 select d.id,ds.tipo,'Execução MDU/Indoor: '||string_agg(ee.endereco||': '||ee.descricao_execucao,' | ' order by s.criada_em,ee.ordem),
 string_agg(ee.endereco,' | ' order by s.criada_em,ee.ordem),'Execução recebida pela Gestão; responsáveis preservados por endereço.'
 from public.qoe_mdu_enderecos_k19 ee join public.demandas_secundarias s on s.id=ee.secundaria_id where s.demanda_origem_id=d.id
 returning id into t;
 update public.qoe_mdu_enderecos_k19 ee set tratativa_execucao_id=t where ee.secundaria_id in(select id from public.demandas_secundarias where demanda_origem_id=d.id) and ee.tratativa_execucao_id is null;
 return public.qoe_k19_finalizar_registro(t,'EXECUTADA','MDU_GESTAO');
end $$;

create or replace function public.qoe_k19_aviso(p_demanda uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select case when c.resultado='RETORNO_TRATAMENTO' and d.status in ('PENDENTE','RECORRENTE') then jsonb_build_object(
 'mensagem','QoE abaixo de 80 após atuação. Necessário continuar o tratamento.','data_leitura',(c.concluida_em at time zone 'America/Sao_Paulo')::date,
 'nota',(select nota from public.qoe_leituras_hfc l where l.porta=p.porta and l.data_leitura=(c.concluida_em at time zone 'America/Sao_Paulo')::date)) end
 from public.demandas d join public.portas_qoe p on p.id=d.porta_id
 left join lateral(select cc.* from public.tratativas t join public.qoe_contexto_atuacao cc on cc.tratativa_id=t.id
 where t.demanda_id=d.id and not exists(select 1 from public.qoe_registros_k19 reg where reg.tratativa_id=t.id and reg.finalidade<>'EXECUTADA')
 order by t.criado_em desc,t.id desc limit 1) c on true where d.id=p_demanda
$$;

create or replace function public.gestao_snapshot_k17() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;monitoring_demand record;begin
 perform public.qoe_k17_gestor();
 perform public.qoe_k172_sincronizar_registros();
 insert into public.qoe_contexto_atuacao(tratativa_id,atuada_em,data_informada,validada_em,decisao)
 select t.id,t.criado_em,false,v.criado_em,case when v.criado_em is not null then 'VALIDADA' end
 from public.tratativas t left join lateral(select h.criado_em from public.historico h
 where h.evento='ATUACAO_VALIDADA' and h.detalhes->>'tratativa_id'=t.id::text order by h.criado_em desc limit 1) v on true
 on conflict(tratativa_id) do update set validada_em=coalesce(qoe_contexto_atuacao.validada_em,excluded.validada_em),
 decisao=coalesce(qoe_contexto_atuacao.decisao,excluded.decisao);
 for monitoring_demand in select id from public.demandas where status='MONITORAMENTO' order by id loop
  perform public.gestao_processar_monitoramento_k17(monitoring_demand.id);
 end loop;
 -- Recuperação sem atuação remove a demanda da carteira de execução, mantendo
 -- a demanda original e o histórico semanal. Queda posterior volta à fila sem dono.
 insert into public.qoe_observacao_carteira(demanda_id,nota)
 select d.id,coalesce(l.nota,p.nota_atual) from public.demandas d join public.portas_qoe p on p.id=d.porta_id
 left join lateral(select nota from public.qoe_leituras_hfc where porta=p.porta order by data_leitura desc limit 1) l on true
 where d.status='PENDENTE' and coalesce(l.nota,p.nota_atual)>=80
 and not exists(select 1 from public.tratativas t where t.demanda_id=d.id and upper(t.tipo_atuacao) not in ('SEM_OPORTUNIDADE','NECESSITA_APOIO') and not exists(select 1 from public.qoe_registros_k19 reg where reg.tratativa_id=t.id and reg.finalidade<>'EXECUTADA'))
 on conflict(demanda_id) do nothing;
 s:=public.gestao_snapshot();
 s:=jsonb_set(s,'{demandas}',coalesce((select jsonb_agg(x||jsonb_build_object('observacao_pre_atuacao',(exists(
  select 1 from public.qoe_observacao_carteira o where o.demanda_id=(x->>'demanda_id')::uuid) and not exists(select 1 from public.tratativas tt join public.qoe_registros_k19 reg on reg.tratativa_id=tt.id where tt.demanda_id=(x->>'demanda_id')::uuid and reg.finalidade='EXECUTADA'))))
  from jsonb_array_elements(s->'demandas') x),'[]'));
 s:=jsonb_set(s,'{tratativas}',coalesce((select jsonb_agg(x||jsonb_build_object(
  'atuada_em',coalesce(c.atuada_em,(x->>'criado_em')::timestamptz),'data_informada',coalesce(c.data_informada,false),
  'sequencia',c.sequencia,'resultado',c.resultado,'validada_em',c.validada_em,
  'leituras_pos',coalesce((select jsonb_agg(jsonb_build_object('data',l.data_leitura,'nota',l.nota) order by l.data_leitura)
   from public.qoe_leituras_hfc l join public.demandas dd on dd.id=(x->>'demanda_id')::uuid join public.portas_qoe p on p.id=dd.porta_id
   where l.porta=p.porta and l.data_leitura>(coalesce(c.atuada_em,(x->>'criado_em')::timestamptz) at time zone 'America/Sao_Paulo')::date),'[]')))
  from jsonb_array_elements(s->'tratativas') x left join public.qoe_contexto_atuacao c on c.tratativa_id=(x->>'id')::uuid),'[]'));
 return s||jsonb_build_object('meses',coalesce((select jsonb_agg(m) from(select distinct to_char(data_leitura,'YYYY-MM') m from public.qoe_leituras_hfc order by m) mm),'[]'),
 'resumo_portas',coalesce((
  with latest as (select max(data_leitura) corte from public.qoe_leituras_hfc), x as (
   select l.*,row_number() over(partition by porta order by data_leitura desc) rn from public.qoe_leituras_hfc l,latest
   where data_leitura>=corte-29
  ), grouped as (select porta,avg(nota) media_30d,max(data_leitura) ultima_data,count(*) cobertura_dias,
    (array_agg(nota order by data_leitura desc))[1] nota_atual,
    jsonb_agg(nota order by data_leitura) filter(where rn<=7) leituras_recentes from x group by porta)
  select jsonb_object_agg(porta,to_jsonb(g)-'porta') from grouped g),'{}'::jsonb));end $$;

create or replace function public.gestao_snapshot_k19() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;r record;begin
 perform public.qoe_k17_gestor();
 -- Só a última tratativa de cada demanda ainda ATUACAO_REGISTRADA é migrada.
 -- Legado MDU é encaminhamento; não presume execução de endereço.
 for r in select distinct on(d.id) t.id from public.demandas d join public.tratativas t on t.demanda_id=d.id
 where d.status='ATUACAO_REGISTRADA' order by d.id,t.criado_em desc,t.id desc loop
  perform public.qoe_k19_finalizar_registro(r.id,null,'LEGADO_PENDENTE');
 end loop;
 s:=public.gestao_snapshot_k17();
 s:=jsonb_set(s,'{demandas}',coalesce((select jsonb_agg(x||jsonb_build_object('retorno_tratamento',public.qoe_k19_aviso((x->>'demanda_id')::uuid))) from jsonb_array_elements(s->'demandas') x),'[]'));
 -- Histórico completo, inclusive demandas encerradas, sem depender do cache local.
 s:=jsonb_set(s,'{tratativas}',coalesce((select jsonb_agg(
 coalesce((select x from jsonb_array_elements(s->'tratativas') x where x->>'id'=tr.id::text limit 1),'{}'::jsonb)||jsonb_build_object(
 'id',tr.id,'demanda_id',tr.demanda_id,'tipo',tr.tipo_atuacao,'descricao',tr.descricao,'endereco',tr.endereco_ofensor,'observacao',tr.observacao,
 'criado_em',tr.criado_em,'atuada_em',tr.criado_em,'data_informada',true,'finalidade',coalesce(reg.finalidade,'EXECUTADA'),
 'porta',p.porta,'node',to_jsonb(p)->>'node','tecnico',tc.nome,'gestor',g.nome,'status_demanda',d.status,
 'resultado',c.resultado,'validada_em',c.validada_em,'sequencia',c.sequencia) order by tr.criado_em desc,tr.id)
 from public.tratativas tr join public.demandas d on d.id=tr.demanda_id join public.portas_qoe p on p.id=d.porta_id
 left join public.tecnicos tc on tc.id=d.tecnico_id left join public.gestores g on g.id=d.gestor_id
 left join public.qoe_contexto_atuacao c on c.tratativa_id=tr.id left join public.qoe_registros_k19 reg on reg.tratativa_id=tr.id),'[]'));
 return s||jsonb_build_object('mdu_enderecos',public.gestao_mdu_ler_k19());
end $$;
create or replace function public.portal_tecnico_carteira_k19(p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 if not exists(select 1 from public.tecnicos where token_acesso=p_token and ativo) then raise exception 'Token inválido';end if;
 select coalesce(jsonb_agg(x||jsonb_build_object('retorno_tratamento',case when c.resultado='RETORNO_TRATAMENTO' and x->>'status' in ('PENDENTE','RECORRENTE') then
 jsonb_build_object('mensagem','QoE abaixo de 80 após atuação. Necessário continuar o tratamento.','data_leitura',(c.concluida_em at time zone 'America/Sao_Paulo')::date,
 'nota',(select nota from public.qoe_leituras_hfc where porta=x->>'porta' and data_leitura=(c.concluida_em at time zone 'America/Sao_Paulo')::date)) end)),'[]') into result
 from jsonb_array_elements(coalesce((select jsonb_agg(to_jsonb(old)) from public.portal_tecnico_carteira(p_token) old),'[]')) x
 left join lateral(select cc.* from public.qoe_contexto_atuacao cc join public.tratativas t on t.id=cc.tratativa_id
 where t.demanda_id=(x->>'demanda_id')::uuid and not exists(select 1 from public.qoe_registros_k19 reg where reg.tratativa_id=t.id and reg.finalidade<>'EXECUTADA')
 order by t.criado_em desc,t.id desc limit 1) c on true
 where not exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=(x->>'demanda_id')::uuid)
 or exists(select 1 from public.tratativas tt join public.qoe_registros_k19 reg on reg.tratativa_id=tt.id where tt.demanda_id=(x->>'demanda_id')::uuid and reg.finalidade='EXECUTADA');
 return result;
end $$;
create or replace function public.gestao_mensal_relatorio_k18(p_mes date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.qoe_meses;first_at timestamptz;last_at timestamptz;result jsonb;
begin
 perform public.qoe_k17_gestor();perform public.qoe_k172_sincronizar_registros();
 select * into strict w from public.qoe_meses where mes=p_mes;
 first_at:=p_mes::timestamp at time zone 'America/Sao_Paulo';
 last_at:=least(clock_timestamp(),(p_mes+interval '1 month')::timestamp at time zone 'America/Sao_Paulo');
 perform public.qoe_mensal_sync_k18(p_mes,last_at);
 with actions as (
  select distinct on(d.tecnico_id,d.porta_id) d.tecnico_id,d.porta_id,t.id,c.validada_em,c.resultado,d.status
  from public.tratativas t join public.demandas d on d.id=t.demanda_id
  left join public.qoe_contexto_atuacao c on c.tratativa_id=t.id
  where t.criado_em>=first_at and t.criado_em<last_at
  and not exists(select 1 from public.qoe_registros_k19 reg where reg.tratativa_id=t.id and reg.finalidade<>'EXECUTADA')
  and upper(coalesce(t.tipo_atuacao,'')) not in ('SEM_OPORTUNIDADE','NECESSITA_APOIO')
  order by d.tecnico_id,d.porta_id,t.criado_em desc,t.id desc
 ), a as (
  select tecnico_id,count(*) atuadas,count(*) filter(where validada_em is not null) validadas,
  count(*) filter(where resultado='ESTABILIZADA') estabilizadas,
  count(*) filter(where resultado='RETORNO_TRATAMENTO') retornos,
  count(*) filter(where validada_em is not null and (resultado is null or resultado='ACOMPANHAMENTO')) acompanhamento
  from actions group by tecnico_id
 ), dev as (
  select d.tecnico_id,count(distinct d.porta_id) devolutivas,
  count(distinct d.porta_id) filter(where d.status='ATUACAO_REGISTRADA' and c.validada_em is null) aguardando_validacao,
  max(t.criado_em) ultima_atuacao
  from public.tratativas t join public.demandas d on d.id=t.demanda_id left join public.qoe_contexto_atuacao c on c.tratativa_id=t.id
  where t.criado_em>=first_at and t.criado_em<last_at group by d.tecnico_id
 ), items as (
  select i.tecnico_id,i.porta_id,bool_and(i.nova) nova,
  bool_or(i.status_periodo in ('PENDENTE','RECORRENTE') and not i.normalizada) pendente,
  bool_and(i.normalizada) normalizada,
  bool_and(i.status_periodo='ENCERRADA') retirada
  from public.qoe_mes_carteira i where i.mes=p_mes group by i.tecnico_id,i.porta_id
 ), carteira as (
  select i.tecnico_id,count(*) recebidas,count(*) filter(where not nova) herdadas,count(*) filter(where nova) novas,
  count(*) filter(where pendente) pendentes,count(*) filter(where normalizada) normalizadas,
  count(*) filter(where retirada) retiradas,
  coalesce(jsonb_agg(p.porta order by p.porta) filter(where pendente),'[]') portas_pendentes
  from items i join public.portas_qoe p on p.id=i.porta_id group by i.tecnico_id
 ), rows as (
 select t.id,t.nome tecnico,coalesce(k.recebidas,0) recebidas,coalesce(k.herdadas,0) herdadas,coalesce(k.novas,0) novas,
 coalesce(k.normalizadas,0) normalizadas,coalesce(k.retiradas,0) retiradas,
 coalesce(a.atuadas,0) atuadas,coalesce(a.validadas,0) validadas,coalesce(a.validadas,0) tratadas,
 coalesce(a.estabilizadas,0) estabilizadas,coalesce(a.retornos,0) retornos,coalesce(a.acompanhamento,0) acompanhamento,
 coalesce(dev.devolutivas,0) devolutivas,coalesce(dev.aguardando_validacao,0) aguardando_validacao,
 (select count(distinct dd.porta_id) from public.qoe_mdu_enderecos_k19 ee join public.demandas_secundarias ds on ds.id=ee.secundaria_id join public.demandas dd on dd.id=ds.demanda_origem_id where dd.tecnico_id=t.id and ee.executada_em is null) mdu_pendentes,
 coalesce(k.pendentes,0) pendentes,coalesce(k.portas_pendentes,'[]') portas_pendentes,
 (coalesce(k.pendentes,0)>0 and coalesce(a.atuadas,0)=0) sem_atuacao,
 case when coalesce(a.estabilizadas,0)+coalesce(a.retornos,0)>0 then round(100.0*a.estabilizadas/(a.estabilizadas+a.retornos),1) end assertividade,
 dev.ultima_atuacao,0 sem_leitura,0 datas_legadas
 from public.tecnicos t left join a on a.tecnico_id=t.id left join carteira k on k.tecnico_id=t.id left join dev on dev.tecnico_id=t.id
 where t.ativo or k.recebidas is not null or dev.devolutivas is not null
 )
 select jsonb_build_object('mes',to_char(p_mes,'YYYY-MM'),'inicio',p_mes,'fim',(p_mes+interval '1 month - 1 day')::date,
 'distribuidas',w.distribuidas,'fechado_em',w.fechado_em,'migracao',w.origem,'atualizado_em',clock_timestamp(),
 'tecnicos',coalesce((select jsonb_agg(to_jsonb(rows)-'id' order by tecnico) from rows),'[]'),
 'totais',jsonb_build_object(
 'recebidas',(select count(distinct porta_id) from items),'pendentes',(select count(distinct porta_id) from items where pendente),
 'normalizadas',(select count(distinct porta_id) from items where normalizada),
 'novas',(select count(distinct porta_id) from items where nova),
 'retiradas',(select count(distinct porta_id) from items where retirada),
 'atuadas',(select count(distinct porta_id) from actions),
 'validadas',(select count(distinct porta_id) from actions where validada_em is not null),
 'estabilizadas',(select count(distinct porta_id) from actions where resultado='ESTABILIZADA'),
 'retornos',(select count(distinct porta_id) from actions where resultado='RETORNO_TRATAMENTO'),
 'acompanhamento',(select count(distinct porta_id) from actions where validada_em is not null and (resultado is null or resultado='ACOMPANHAMENTO')),
 'tecnicos_atuantes',(select count(*) from rows where atuadas>0),'total_tecnicos',(select count(*) from rows)),
 'conflitos',coalesce((select jsonb_agg(to_jsonb(z)) from(
  select p.porta,count(*) demandas,string_agg(t.nome,', ' order by t.nome) tecnicos
  from public.demandas d join public.portas_qoe p on p.id=d.porta_id join public.tecnicos t on t.id=d.tecnico_id
  where d.status in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA','MONITORAMENTO')
  and not exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=d.id)
  group by p.porta having count(*)>1) z),'[]')) into result;
 return result;
end $$;

create or replace function public.qoe_mensal_sync_k18(p_mes date,p_corte timestamptz) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare first_at timestamptz;last_at timestamptz;
begin
 if not exists(select 1 from public.qoe_meses where mes=p_mes and fechado_em is null) then return;end if;
 first_at:=p_mes::timestamp at time zone 'America/Sao_Paulo';
 last_at:=least(p_corte,(p_mes+interval '1 month')::timestamp at time zone 'America/Sao_Paulo');
 -- Alocações feitas no mês por qualquer tela são recebimento; não são criadas aqui.
 insert into public.qoe_mes_carteira(mes,demanda_id,porta_id,tecnico_id,nova,recebida_em)
 select p_mes,id,porta_id,tecnico_id,true,coalesce(distribuida_em,criada_em) from public.demandas
 where coalesce(distribuida_em,criada_em)>=first_at and coalesce(distribuida_em,criada_em)<last_at and tecnico_id is not null
 on conflict(mes,demanda_id) do nothing;
 -- Demanda antiga que recebe atuação ou retorna ao tratamento neste mês
 -- volta à carga mensal com o MESMO id/técnico; nenhum recebimento é apagado.
 insert into public.qoe_mes_carteira(mes,demanda_id,porta_id,tecnico_id,nova,recebida_em)
 select p_mes,d.id,d.porta_id,d.tecnico_id,false,first_at from public.demandas d
 where coalesce(d.distribuida_em,d.criada_em)<first_at and d.tecnico_id is not null
 and (exists(select 1 from public.tratativas t where t.demanda_id=d.id and t.criado_em>=first_at and t.criado_em<last_at)
 or exists(select 1 from public.historico h where h.demanda_id=d.id and h.evento in ('MONITORAMENTO_RETORNO_TRATAMENTO','ATUACAO_DEVOLVIDA_TRATAMENTO') and h.criado_em>=first_at and h.criado_em<last_at))
 on conflict(mes,demanda_id) do nothing;
 update public.qoe_mes_carteira i set status_periodo=public.qoe_mensal_status_k18(i.demanda_id,last_at),
 normalizada=exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=i.demanda_id and o.observada_em<last_at and not exists(select 1 from public.tratativas tt join public.qoe_registros_k19 reg on reg.tratativa_id=tt.id where tt.demanda_id=i.demanda_id and tt.criado_em<last_at and reg.finalidade='EXECUTADA'))
 where i.mes=p_mes;
end $$;

revoke all on function public.qoe_k19_aviso(uuid),public.qoe_k19_mdu_sync(),public.qoe_k19_secundaria(uuid),public.qoe_k19_processar(uuid),public.qoe_k19_finalizar_registro(uuid,text,text) from public,anon,authenticated;
revoke all on function public.gestao_snapshot_k19(),public.gestao_mdu_ler_k19(),public.gestao_mdu_cadastrar_k19(uuid,text,jsonb,text),public.gestao_mdu_direcionar_k19(uuid,text,integer),public.gestao_mdu_executar_k19(uuid,text,integer),public.gestao_registrar_tratativa_k19(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.gestao_snapshot_k19(),public.gestao_mdu_ler_k19(),public.gestao_mdu_cadastrar_k19(uuid,text,jsonb,text),public.gestao_mdu_direcionar_k19(uuid,text,integer),public.gestao_mdu_executar_k19(uuid,text,integer),public.gestao_registrar_tratativa_k19(text,text,text,text,text,text,text) to authenticated;
revoke all on function public.portal_tecnico_registrar_atuacao_k19(uuid,uuid,text,text,text,text,text),public.portal_tecnico_carteira_k19(uuid) from public;
grant execute on function public.portal_tecnico_registrar_atuacao_k19(uuid,uuid,text,text,text,text,text),public.portal_tecnico_carteira_k19(uuid) to anon,authenticated;
select public.qoe_k19_mdu_sync();
commit;
