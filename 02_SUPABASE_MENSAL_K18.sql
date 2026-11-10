-- K18: controle MENSAL adicional; aplicar após K17.1 e K17.2.
-- Migração para novembro/2026 sem recriar carteiras ou alterar demandas.semana.
begin;
do $$begin
 if pg_get_function_result('public.qoe_gestor_atual()'::regprocedure)<>'uuid' then raise exception 'Gestor deve retornar UUID';end if;
 perform 'public.qoe_k172_sincronizar_registros()'::regprocedure;
 -- Não reutiliza silenciosamente uma tabela mensal de outra integração.
 if (to_regclass('public.qoe_meses') is not null or to_regclass('public.qoe_mes_carteira') is not null)
 and to_regprocedure('public.gestao_mensal_ler_k18()') is null then
 raise exception 'Já existe estrutura mensal sem a integração K18. Inspecione o schema antes de aplicar.';end if;
 perform id,porta_id,tecnico_id,status,distribuida_em,criada_em from public.demandas limit 0;
 perform numero,inicio,fechamento from public.qoe_semanas limit 0;
 if (now() at time zone 'America/Sao_Paulo')::date<date '2026-11-01' then raise exception 'Migração autorizada a partir de novembro/2026';end if;
end $$;
create table if not exists public.qoe_meses (
 mes date primary key check(extract(day from mes)=1),
 aberto_em timestamptz not null default now(),fechado_em timestamptz,
 aberto_por uuid,fechado_por uuid,fechamento jsonb,distribuidas jsonb not null default '{}'::jsonb,
 legado_semanal jsonb,origem text not null default 'MENSAL'
);
create unique index if not exists qoe_um_mes_aberto on public.qoe_meses((true)) where fechado_em is null;
create table if not exists public.qoe_mes_carteira (
 mes date not null references public.qoe_meses(mes),
 demanda_id uuid not null references public.demandas(id),
 porta_id uuid not null references public.portas_qoe(id),
 tecnico_id uuid not null references public.tecnicos(id),
 nova boolean not null,recebida_em timestamptz not null,
 status_periodo text,normalizada boolean not null default false,
 primary key(mes,demanda_id)
);
alter table public.qoe_meses enable row level security;
alter table public.qoe_mes_carteira enable row level security;
revoke all on public.qoe_meses,public.qoe_mes_carteira from public,anon,authenticated;

-- Consulta o estado no corte sem usar a nota atual para reconstruir um mês passado.
create or replace function public.qoe_mensal_status_k18(p_demanda uuid,p_corte timestamptz) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.demandas;ev text;tr public.tratativas;c public.qoe_contexto_atuacao;
begin
 select * into strict d from public.demandas where id=p_demanda;
 if p_corte>=now() then return d.status;end if;
 select h.evento into ev from public.historico h where h.demanda_id=d.id and h.criado_em<p_corte
 and h.evento in ('ALOCACAO','ATUACAO_REGISTRADA','ATUACAO_VALIDADA','ATUACAO_DEVOLVIDA_TRATAMENTO','MONITORAMENTO_RETORNO_TRATAMENTO','MONITORAMENTO_ESTABILIZADO','RETIRADA_DA_CARTEIRA')
 order by h.criado_em desc,h.id desc limit 1;
 if ev='RETIRADA_DA_CARTEIRA' then return 'ENCERRADA';end if;
 if ev in ('ATUACAO_DEVOLVIDA_TRATAMENTO','MONITORAMENTO_RETORNO_TRATAMENTO') then return 'PENDENTE';end if;
 if ev='MONITORAMENTO_ESTABILIZADO' then return 'ESTABILIZADA';end if;
 select * into tr from public.tratativas where demanda_id=d.id and criado_em<p_corte order by criado_em desc,id desc limit 1;
 if found then
  select * into c from public.qoe_contexto_atuacao where tratativa_id=tr.id;
  if c.validada_em<p_corte then
   if c.concluida_em<p_corte and c.resultado='ESTABILIZADA' then return 'ESTABILIZADA';end if;
   if c.concluida_em<p_corte and c.resultado='RETORNO_TRATAMENTO' then return 'PENDENTE';end if;
   return 'MONITORAMENTO';
  end if;
  if ev='ATUACAO_VALIDADA' then return 'MONITORAMENTO';end if;
  return 'ATUACAO_REGISTRADA';
 end if;
 return 'PENDENTE';
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
 normalizada=exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=i.demanda_id and o.observada_em<last_at)
 where i.mes=p_mes;
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
create or replace function public.gestao_mensal_ler_k18() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m date;result jsonb;s jsonb;begin
 perform public.qoe_k17_gestor();perform pg_advisory_xact_lock(18001101);
 -- Atualiza apenas o fluxo operacional existente, nunca aloca portas.
 s:=public.gestao_snapshot_k17();
 select mes into strict m from public.qoe_meses where fechado_em is null;
 select jsonb_build_object('versao',180,'mes_atual',to_char(m,'YYYY-MM'),'atualizado_em',clock_timestamp(),
 'meses',jsonb_agg(public.gestao_mensal_relatorio_k18(w.mes) order by w.mes),
 'semanas_legadas',(select legado_semanal from public.qoe_meses where legado_semanal is not null order by mes limit 1))
 into result from public.qoe_meses w;
 return result;
end $$;
create or replace function public.gestao_mensal_alocar_k18(p_porta text,p_tecnico text,p_mes_esperado date,p_substituir boolean default false) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare m date;demand uuid;n integer;p uuid;active_d public.demandas;begin
 perform public.qoe_k17_gestor();perform pg_advisory_xact_lock(18001101);perform pg_advisory_xact_lock(16501910);
 select mes into strict m from public.qoe_meses where fechado_em is null;
 if m is distinct from p_mes_esperado then raise exception 'O mês mudou. Atualize a Gestão.';end if;
 if m<>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date then raise exception 'Inicie o mês atual antes de distribuir novas portas.';end if;
 select id into strict p from public.portas_qoe where porta=p_porta for update;
 select d.* into active_d from public.demandas d where d.porta_id=p and d.status in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA','MONITORAMENTO')
 and not exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=d.id)
 order by coalesce(d.distribuida_em,d.criada_em) desc,d.id limit 1;
 if found then
  if not p_substituir or active_d.status not in ('PENDENTE','RECORRENTE')
  or active_d.tecnico_id=(select id from public.tecnicos where nome=p_tecnico)
  or (select count(*) from public.demandas d where d.porta_id=p and d.status in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA','MONITORAMENTO')
    and not exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=d.id))>1
  then raise exception 'Porta já possui demanda ativa. Confira a carteira; transferência exige confirmação explícita e uma única pendência.';end if;
 end if;
 -- Campo semana mantido exclusivamente para compatibilidade histórica da RPC original.
 select coalesce(max(numero),1) into n from public.qoe_semanas;
 demand:=public.gestao_alocar(p_porta,p_tecnico,n);
 perform public.qoe_mensal_sync_k18(m,clock_timestamp());return demand;
end $$;
create or replace function public.gestao_mensal_iniciar_k18(p_mes_esperado date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m date;next_m date;actor uuid;cutoff timestamptz;begin
 actor:=public.qoe_k17_gestor();perform pg_advisory_xact_lock(18001101);
 select mes into strict m from public.qoe_meses where fechado_em is null;
 if m is distinct from p_mes_esperado then raise exception 'O mês mudou em outro computador. Atualize.';end if;
 next_m:=(m+interval '1 month')::date;
 if next_m>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date then raise exception 'O próximo mês ainda não começou.';end if;
 cutoff:=next_m::timestamp at time zone 'America/Sao_Paulo';
 perform public.qoe_mensal_sync_k18(m,cutoff);
 update public.qoe_meses set fechamento=public.gestao_mensal_relatorio_k18(m),fechado_em=clock_timestamp(),fechado_por=actor where mes=m;
 insert into public.qoe_meses(mes,aberto_por) values(next_m,actor);
 insert into public.qoe_mes_carteira(mes,demanda_id,porta_id,tecnico_id,nova,recebida_em)
 select next_m,demanda_id,porta_id,tecnico_id,false,cutoff from public.qoe_mes_carteira
 where mes=m and status_periodo in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA') and not normalizada
 on conflict(mes,demanda_id) do nothing;
 return public.gestao_mensal_ler_k18();
end $$;

create or replace function public.gestao_mensal_distribuida_k18(p_tecnico text,p_mes_esperado date,p_distribuida boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m date;begin
 perform public.qoe_k17_gestor();perform pg_advisory_xact_lock(18001101);
 select mes into strict m from public.qoe_meses where fechado_em is null;
 if m is distinct from p_mes_esperado then raise exception 'O mês mudou. Atualize.';end if;
 if not exists(select 1 from public.tecnicos where nome=p_tecnico and ativo) then raise exception 'Técnico não localizado';end if;
 update public.qoe_meses set distribuidas=case when p_distribuida then jsonb_set(distribuidas,array[p_tecnico],jsonb_build_object(
 'date',to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY'),'time',to_char(now() at time zone 'America/Sao_Paulo','HH24:MI')))
 else distribuidas-p_tecnico end where mes=m;
 return public.gestao_mensal_ler_k18();
end $$;

-- Migração idempotente. Nunca cria/encerra/redistribui uma demanda.
do $$declare m date:=date '2026-11-01';first_at timestamptz;begin
 perform pg_advisory_xact_lock(18001101);
 if exists(select 1 from public.qoe_meses) then return;end if;
 first_at:=m::timestamp at time zone 'America/Sao_Paulo';
 insert into public.qoe_meses(mes,origem,legado_semanal)
 select m,'MIGRACAO_NOVEMBRO',coalesce(jsonb_agg(coalesce(fechamento,public.qoe_semanal_retrato_k165(numero)) order by numero),'[]') from public.qoe_semanas;
 insert into public.qoe_mes_carteira(mes,demanda_id,porta_id,tecnico_id,nova,recebida_em)
 select m,d.id,d.porta_id,d.tecnico_id,coalesce(d.distribuida_em,d.criada_em)>=first_at,
 greatest(first_at,coalesce(d.distribuida_em,d.criada_em)) from public.demandas d
 where d.tecnico_id is not null and coalesce(d.distribuida_em,d.criada_em)<now()
 and (coalesce(d.distribuida_em,d.criada_em)>=first_at
 or (d.status in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA') and not exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=d.id))
 or exists(select 1 from public.tratativas t where t.demanda_id=d.id and t.criado_em>=first_at and t.criado_em<now())
 or exists(select 1 from public.qoe_observacao_carteira o where o.demanda_id=d.id and o.observada_em>=first_at)
 or exists(select 1 from public.historico h where h.demanda_id=d.id and h.evento='RETIRADA_DA_CARTEIRA' and h.criado_em>=first_at))
 on conflict(mes,demanda_id) do nothing;
 perform public.qoe_mensal_sync_k18(m,clock_timestamp());
end $$;
revoke all on function public.qoe_mensal_status_k18(uuid,timestamptz),public.qoe_mensal_sync_k18(date,timestamptz) from public,anon,authenticated;
revoke all on function public.gestao_mensal_ler_k18(),public.gestao_mensal_relatorio_k18(date),public.gestao_mensal_alocar_k18(text,text,date,boolean),public.gestao_mensal_iniciar_k18(date),public.gestao_mensal_distribuida_k18(text,date,boolean) from public,anon;
grant execute on function public.gestao_mensal_ler_k18(),public.gestao_mensal_relatorio_k18(date),public.gestao_mensal_alocar_k18(text,text,date,boolean),public.gestao_mensal_iniciar_k18(date),public.gestao_mensal_distribuida_k18(text,date,boolean) to authenticated;
commit;
