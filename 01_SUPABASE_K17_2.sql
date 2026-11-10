-- K17.2: aplicar uma única vez, integralmente, no SQL Editor do Supabase.
-- Pré-requisito: K17.1 instalada. Nenhuma tabela, status, usuário ou vínculo é criado/alterado.
-- Regra aprovada em 03/11: referência = tratativas.criado_em (registro no Portal).
-- Assinaturas anteriores preservadas. Não muda qoe_gestor_atual nem RPCs originais.
begin;
do $$ begin
 if pg_get_function_result('public.qoe_gestor_atual()'::regprocedure)<>'uuid' then raise exception 'qoe_gestor_atual deve retornar UUID';end if;
 perform atuada_em,data_informada,origem_data from public.qoe_contexto_atuacao limit 0;
 if exists(select 1 from public.tratativas where criado_em is null) then raise exception 'Há tratativas sem data de registro: investigar antes de continuar';end if;
 perform 'public.gestao_snapshot_k17()'::regprocedure;
 perform 'public.gestao_relatorio_tecnicos_k17(integer)'::regprocedure;
end $$;
create or replace function public.qoe_k172_sincronizar_registros() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Referência aprovada: timestamp original do registro, nunca a aprovação.
 insert into public.qoe_contexto_atuacao(tratativa_id,atuada_em,data_informada,origem_data)
 select id,criado_em,true,'REGISTRO_PORTAL' from public.tratativas
 on conflict(tratativa_id) do update set atuada_em=excluded.atuada_em,
 data_informada=true,origem_data=excluded.origem_data
 where qoe_contexto_atuacao.atuada_em is distinct from excluded.atuada_em
 or not qoe_contexto_atuacao.data_informada or qoe_contexto_atuacao.origem_data is distinct from excluded.origem_data;
end $$;

create or replace function public.portal_tecnico_registrar_atuacao_k17(
 p_token uuid,p_demanda uuid,p_tipo text,p_descricao text,p_endereco text,p_observacao text,p_atuada_em timestamptz)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare id_tr uuid;dist timestamptz;begin
 select d.distribuida_em into dist from public.demandas d join public.tecnicos t on t.id=d.tecnico_id
 where d.id=p_demanda and t.token_acesso=p_token and t.ativo for update of d;
 if not found then raise exception 'Carteira não autorizada';end if;
 if exists(select 1 from public.qoe_observacao_carteira where demanda_id=p_demanda) then raise exception 'Porta em observação; solicite nova distribuição à Gestão';end if;
 id_tr:=public.portal_tecnico_registrar_atuacao(p_token,p_demanda,p_tipo,p_descricao,p_endereco,p_observacao);
 insert into public.qoe_contexto_atuacao(tratativa_id,atuada_em,data_informada,origem_data) select id,criado_em,true,'REGISTRO_PORTAL' from public.tratativas where id=id_tr;
 return id_tr;end $$;

create or replace function public.gestao_registrar_tratativa_k17(
 p_porta text,p_gestor_nome text,p_tipo text,p_descricao text,p_endereco text,p_observacao text,p_atuada_em timestamptz)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare tr uuid;begin perform public.qoe_k17_gestor();
 tr:=public.gestao_registrar_tratativa(p_porta,p_gestor_nome,p_tipo,p_descricao,p_endereco,p_observacao);
 insert into public.qoe_contexto_atuacao(tratativa_id,atuada_em,data_informada,origem_data) select id,criado_em,true,'REGISTRO_PORTAL' from public.tratativas where id=tr;
 return tr;end $$;

create or replace function public.gestao_processar_monitoramento_k17(p_demanda_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.demandas;c public.qoe_contexto_atuacao;r record;action_day date;prev date;
 seq integer:=0;best integer:=0;bad boolean:=false;end_day date;new_status text;port text;vals jsonb:='[]';
begin
 perform public.qoe_k17_gestor();
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
   jsonb_build_object('tratativa_id',c.tratativa_id,'data_atuacao',c.atuada_em,'ultima_data',end_day,'sequencia',seq,'status_novo',new_status,'tecnico_id_mantido',d.tecnico_id));
 end if;
 return jsonb_build_object('status',new_status,'sequencia',seq,'leituras_pos',vals,'tratativa_id',c.tratativa_id);
end $$;

create or replace function public.gestao_validar_atuacao_k17(p_demanda_id uuid,p_tratativa_id uuid,p_atuada_em timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.qoe_k17_gestor();
 -- p_atuada_em permanece por compatibilidade, mas não define a referência.
 perform 1 from public.tratativas t join public.demandas d on d.id=t.demanda_id
 where t.id=p_tratativa_id and t.demanda_id=p_demanda_id for update of d;
 if not found then raise exception 'Tratativa não pertence à demanda';end if;
 perform public.gestao_validar_atuacao(p_demanda_id,p_tratativa_id);
 insert into public.qoe_contexto_atuacao(tratativa_id,atuada_em,data_informada,origem_data,validada_em,decisao)
 select id,criado_em,true,'REGISTRO_PORTAL',clock_timestamp(),'VALIDADA' from public.tratativas where id=p_tratativa_id
 on conflict(tratativa_id) do update set atuada_em=excluded.atuada_em,data_informada=true,
 origem_data='REGISTRO_PORTAL',validada_em=excluded.validada_em,decisao='VALIDADA';
 return public.gestao_processar_monitoramento_k17(p_demanda_id);
end $$;

create or replace function public.gestao_confirmar_data_atuacao_k17(p_tratativa_id uuid,p_atuada_em timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare demand uuid;begin
 perform public.qoe_k17_gestor();
 select demanda_id into strict demand from public.tratativas where id=p_tratativa_id;
 perform public.qoe_k172_sincronizar_registros();
 return public.gestao_processar_monitoramento_k17(demand);
end $$;

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
 and not exists(select 1 from public.tratativas t where t.demanda_id=d.id)
 on conflict(demanda_id) do nothing;
 s:=public.gestao_snapshot();
 s:=jsonb_set(s,'{demandas}',coalesce((select jsonb_agg(x||jsonb_build_object('observacao_pre_atuacao',exists(
  select 1 from public.qoe_observacao_carteira o where o.demanda_id=(x->>'demanda_id')::uuid)))
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

create or replace function public.portal_tecnico_contexto_k17(p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare tech uuid;result jsonb;begin
 select id into tech from public.tecnicos where token_acesso=p_token and ativo;
 if tech is null then raise exception 'Token inválido';end if;
 select coalesce(jsonb_agg(jsonb_build_object('tratativa_id',t.id,'demanda_id',d.id,'porta',p.porta,'criado_em',t.criado_em,
  'atuada_em',t.criado_em,'data_informada',true)),'[]') into result
 from public.tratativas t join public.demandas d on d.id=t.demanda_id join public.portas_qoe p on p.id=d.porta_id
 left join public.qoe_contexto_atuacao c on c.tratativa_id=t.id where d.tecnico_id=tech;
 return result;end $$;

create or replace function public.gestao_relatorio_tecnicos_k17(p_semana integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.qoe_semanas;end_at timestamptz;result jsonb;
begin
 perform public.qoe_k17_gestor();perform public.qoe_k172_sincronizar_registros();select * into strict w from public.qoe_semanas where numero=p_semana;
 end_at:=least(clock_timestamp(),(coalesce(w.fim+1,(now() at time zone 'America/Sao_Paulo')::date+1)::timestamp at time zone 'America/Sao_Paulo'));
 with actions as (
  select distinct on(d.tecnico_id,d.porta_id) d.tecnico_id,d.porta_id,t.id,c.validada_em,c.resultado,
   coalesce(c.atuada_em,t.criado_em) atuada_em,
   (upper(t.tipo_atuacao) not in ('SEM_OPORTUNIDADE','NECESSITA_APOIO')) real_action,
   d.status,c.data_informada
  from public.tratativas t join public.demandas d on d.id=t.demanda_id
  left join public.qoe_contexto_atuacao c on c.tratativa_id=t.id
  where coalesce(c.atuada_em,t.criado_em)>=(w.inicio::timestamp at time zone 'America/Sao_Paulo')
  and coalesce(c.atuada_em,t.criado_em)<end_at
  order by d.tecnico_id,d.porta_id,t.criado_em desc,t.id desc
 ), a as (
  select tecnico_id,count(*) devolutivas,count(*) filter(where real_action) atuadas,
   count(*) filter(where real_action and validada_em is not null) validadas,
   count(*) filter(where status='ATUACAO_REGISTRADA') aguardando_validacao,
   count(*) filter(where real_action and resultado='ESTABILIZADA') estabilizadas,
   count(*) filter(where real_action and resultado='RETORNO_TRATAMENTO') retornos,
   count(*) filter(where real_action and validada_em is not null and (resultado is null or resultado='ACOMPANHAMENTO')) acompanhamento,
   count(*) filter(where not coalesce(data_informada,false)) datas_legadas
  from actions group by tecnico_id
 ), carteira as (
  select i.tecnico_id,count(*) recebidas,count(*) filter(where not nova) herdadas,count(*) filter(where nova) novas,
   count(*) filter(where i.pendente and coalesce(i.status_origem,'') in ('PENDENTE','RECORRENTE') and o.demanda_id is null) pendentes,
   coalesce(jsonb_agg(p.porta order by p.porta) filter(where i.pendente and coalesce(i.status_origem,'') in ('PENDENTE','RECORRENTE') and o.demanda_id is null),'[]') portas_pendentes
  from public.qoe_semana_portas i join public.portas_qoe p on p.id=i.porta_id
  left join public.qoe_observacao_carteira o on o.demanda_id=i.demanda_id where i.semana=w.numero group by i.tecnico_id
 )
 select jsonb_build_object('semana',w.numero,'inicio',w.inicio,'fim',w.fim,'atualizado_em',clock_timestamp(),
 'tecnicos',coalesce(jsonb_agg(jsonb_build_object(
 'tecnico',t.nome,'recebidas',coalesce(k.recebidas,0),'herdadas',coalesce(k.herdadas,0),'novas',coalesce(k.novas,0),
 'atuadas',coalesce(a.atuadas,0),'devolutivas',coalesce(a.devolutivas,0),'validadas',coalesce(a.validadas,0),
 'aguardando_validacao',coalesce(a.aguardando_validacao,0),'estabilizadas',coalesce(a.estabilizadas,0),
 'retornos',coalesce(a.retornos,0),'acompanhamento',coalesce(a.acompanhamento,0),'pendentes',coalesce(k.pendentes,0),
 'datas_legadas',greatest(coalesce(a.datas_legadas,0),coalesce(uncertain.n,0)),'portas_pendentes',coalesce(k.portas_pendentes,'[]'),
 'sem_atuacao',(coalesce(k.pendentes,0)>0 and coalesce(a.atuadas,0)=0 and coalesce(uncertain.n,0)=0),
 'assertividade',case when coalesce(a.estabilizadas,0)+coalesce(a.retornos,0)>0 then round(100.0*a.estabilizadas/(a.estabilizadas+a.retornos),1) else null end,
 'ultima_atuacao',(select max(coalesce(cc.atuada_em,tt.criado_em)) from public.tratativas tt join public.demandas dd on dd.id=tt.demanda_id
 left join public.qoe_contexto_atuacao cc on cc.tratativa_id=tt.id where dd.tecnico_id=t.id)
 ) order by t.nome),'[]')) into result
 from public.tecnicos t left join a on a.tecnico_id=t.id left join carteira k on k.tecnico_id=t.id
 left join lateral(select count(*) n from public.tratativas lt join public.demandas ld on ld.id=lt.demanda_id
  left join public.qoe_contexto_atuacao lc on lc.tratativa_id=lt.id
  where ld.tecnico_id=t.id and not coalesce(lc.data_informada,false)
  and lt.criado_em>=(w.inicio::timestamp at time zone 'America/Sao_Paulo')) uncertain on true
 where t.ativo or k.recebidas is not null or a.devolutivas is not null;
 return result;end $$;
revoke all on function public.qoe_k172_sincronizar_registros() from public,anon,authenticated;
-- As funções substituídas mantêm suas permissões da K17.1.
select public.qoe_k172_sincronizar_registros();
commit;
