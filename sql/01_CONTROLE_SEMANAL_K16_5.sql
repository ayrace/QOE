-- QoE HFC K16.5 — integração semanal ADICIONAL.
-- Aplicar integralmente no SQL Editor. Nenhuma função existente é substituída.
-- Não altera demandas.semana, status, usuários, carteiras ou a base diária.
begin;

do $$
begin
 if to_regprocedure('public.qoe_gestor_atual()') is null or
    pg_get_function_result(to_regprocedure('public.qoe_gestor_atual()')) <> 'uuid'
 then raise exception 'Pré-requisito: qoe_gestor_atual() deve retornar uuid.'; end if;
 if to_regprocedure('public.gestao_alocar(text,text,integer)') is null
 then raise exception 'RPC gestao_alocar existente não encontrada.'; end if;
 -- Confere também as colunas utilizadas pelos joins, sem modificar o schema antigo.
 perform id,porta,nota_atual from public.portas_qoe limit 0;
 perform id,nome,ativo from public.tecnicos limit 0;
 perform semana,distribuida_em,criada_em,encerrada_em from public.demandas limit 0;
end $$;

create table if not exists public.qoe_semanas (
 numero integer primary key check(numero>0),
 inicio date not null,
 fim date,
 fechada_em timestamptz,
 aberta_por uuid,
 fechada_por uuid,
 legado_distrib_importado boolean not null default false,
 distribuidas jsonb not null default '{}'::jsonb,
 fechamento jsonb,
 check(fim is null or fim>=inicio),
 check((fechada_em is null)=(fim is null))
);
create unique index if not exists qoe_uma_semana_aberta
 on public.qoe_semanas ((true)) where fechada_em is null;

create table if not exists public.qoe_semana_portas (
 semana integer not null references public.qoe_semanas(numero),
 porta_id uuid not null references public.portas_qoe(id),
 demanda_id uuid not null references public.demandas(id),
 tecnico_id uuid not null references public.tecnicos(id),
 nova boolean not null,
 recebida_em timestamptz not null,
 tratada boolean not null default false,
 normalizada boolean not null default false,
 pendente boolean not null default true,
 retirada boolean not null default false,
 teve_atuacao boolean not null default false,
 nota numeric,
 status_origem text,
 primary key(semana,porta_id)
);

alter table public.qoe_semanas enable row level security;
alter table public.qoe_semana_portas enable row level security;
revoke all on public.qoe_semanas,public.qoe_semana_portas from public,anon,authenticated;

-- A instalação não abre automaticamente a semana 2.
insert into public.qoe_semanas(numero,inicio)
 values(1,date '2026-10-09') on conflict(numero) do nothing;

create or replace function public.qoe_semanal_exigir_gestor_k165()
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare g uuid;
begin
 g:=public.qoe_gestor_atual();
 if g is null then raise exception 'Gestor não autorizado.'; end if;
 return g;
end $$;

create or replace function public.qoe_semanal_sync_k165(
 p_semana integer,p_limite timestamptz,p_dia date,p_historico boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.qoe_semanas; r record; ev text; st text; acted boolean;
 done boolean; norm boolean; grade numeric; base jsonb; reading text;
begin
 select * into strict w from public.qoe_semanas where numero=p_semana;
 if w.fechada_em is not null then return; end if;
 select dados into base from public.qoe_base_diaria where id=1;

 -- Grão: uma porta física por semana. Histórico de demandas nunca é apagado.
 -- O número de demandas pode ser maior que o número de portas recebidas.
 insert into public.qoe_semana_portas(semana,porta_id,demanda_id,tecnico_id,nova,recebida_em)
 select p_semana,d.porta_id,d.id,d.tecnico_id,true,
        coalesce(d.distribuida_em,d.criada_em)
 from (
   select distinct on(porta_id) * from public.demandas
   where semana=p_semana and coalesce(distribuida_em,criada_em)<p_limite
   order by porta_id,coalesce(distribuida_em,criada_em) desc,id
 ) d
 on conflict(semana,porta_id) do update set demanda_id=excluded.demanda_id;

 for r in
   select i.*,d.status,d.encerrada_em,p.porta,p.nota_atual
   from public.qoe_semana_portas i
   join public.demandas d on d.id=i.demanda_id
   join public.portas_qoe p on p.id=i.porta_id
   where i.semana=p_semana
 loop
   st:=r.status;
   if p_historico then
     select h.evento into ev from public.historico h
     where h.demanda_id=r.demanda_id and h.criado_em<p_limite
       and h.evento in ('ALOCACAO','ATUACAO_REGISTRADA','ATUACAO_VALIDADA',
         'ATUACAO_DEVOLVIDA_TRATAMENTO','MONITORAMENTO_RETORNO_TRATAMENTO','RETIRADA_DA_CARTEIRA')
     order by h.criado_em desc,h.id desc limit 1;
     st:=case ev
       when 'ATUACAO_REGISTRADA' then 'ATUACAO_REGISTRADA'
       when 'ATUACAO_VALIDADA' then 'MONITORAMENTO'
       when 'MONITORAMENTO_RETORNO_TRATAMENTO' then 'RECORRENTE'
       when 'RETIRADA_DA_CARTEIRA' then 'ENCERRADA'
       else 'PENDENTE' end;
     if r.encerrada_em is not null and r.encerrada_em<p_limite then st:='ENCERRADA'; end if;
   end if;
   acted:=exists(select 1 from public.tratativas t
      where t.demanda_id=r.demanda_id and t.criado_em<p_limite)
     or exists(select 1 from public.historico h where h.demanda_id=r.demanda_id
       and h.criado_em<p_limite and h.evento='ATUACAO_REGISTRADA')
     or st in ('ATUACAO_REGISTRADA','MONITORAMENTO','ESTABILIZADA','RECORRENTE');
   done:=exists(select 1 from public.historico h
     where h.porta_id=r.porta_id and h.evento='ATUACAO_VALIDADA'
       and h.criado_em >= (w.inicio::timestamp at time zone 'America/Sao_Paulo')
       and h.criado_em<p_limite);
   grade:=null;reading:=null;
   if base->>'mes'=to_char(p_dia,'YYYY-MM') then
     select e.value #>> '{}' into reading
     from jsonb_each(coalesce(base->'oct'->r.porta->1,'{}'::jsonb)) e
     where e.key ~ '^[0-9]{1,2}$' and e.key::integer between 1 and extract(day from p_dia)::integer
       and jsonb_typeof(e.value)='number'
     order by e.key::integer desc limit 1;
     if reading is not null then grade:=reading::numeric; end if;
   end if;
   -- Nunca usa a nota de hoje para fechar uma semana passada.
   if grade is null and not p_historico then grade:=r.nota_atual; end if;
   norm:=not acted and not done and grade>=80;
   update public.qoe_semana_portas set
     tratada=done,teve_atuacao=acted,nota=grade,status_origem=st,
     normalizada=coalesce(norm,false),
     pendente=(st in ('PENDENTE','RECORRENTE','ATUACAO_REGISTRADA') and not coalesce(norm,false)),
     retirada=(st='ENCERRADA' and not done and not coalesce(norm,false))
   where semana=p_semana and porta_id=r.porta_id;
 end loop;
end $$;

create or replace function public.qoe_semanal_retrato_k165(p_semana integer)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
   'semana',w.numero,'inicio',w.inicio,'fim',w.fim,'fechada_em',w.fechada_em,
   'distribuidas',w.distribuidas,
   'tecnicos',coalesce((select jsonb_agg(jsonb_build_object(
      'tecnico',t.nome,'recebidas',coalesce(m.recebidas,0),'tratadas',coalesce(m.tratadas,0),
      'normalizadas',coalesce(m.normalizadas,0),'pendentes',coalesce(m.pendentes,0),
      'novas',coalesce(m.novas,0),'retiradas',coalesce(m.retiradas,0),
      'sem_leitura',coalesce(m.sem_leitura,0)) order by t.nome)
    from public.tecnicos t left join (
      select tecnico_id,count(*) recebidas,count(*) filter(where tratada) tratadas,
        count(*) filter(where normalizada) normalizadas,count(*) filter(where pendente) pendentes,
        count(*) filter(where nova) novas,count(*) filter(where retirada) retiradas,
        count(*) filter(where nota is null) sem_leitura
      from public.qoe_semana_portas where semana=p_semana group by tecnico_id
    ) m on m.tecnico_id=t.id
    where t.ativo or m.recebidas is not null),'[]'::jsonb),
   'demandas_origem',(select count(*) from public.demandas where semana=p_semana),
   'demandas_apos_corte',(select count(*) from public.demandas where semana=p_semana
     and w.fim is not null and coalesce(distribuida_em,criada_em)>=
       ((w.fim+1)::timestamp at time zone 'America/Sao_Paulo'))
 ) from public.qoe_semanas w where numero=p_semana;
$$;

create or replace function public.gestao_semanal_ler()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; result jsonb;
begin
 perform public.qoe_semanal_exigir_gestor_k165();
 perform pg_advisory_xact_lock(16501910);
 select numero into strict n from public.qoe_semanas where fechada_em is null;
 perform public.qoe_semanal_sync_k165(n,clock_timestamp(),(now() at time zone 'America/Sao_Paulo')::date,false);
 select jsonb_build_object('versao',165,'semana_atual',n,'atualizado_em',clock_timestamp(),
   'importacao_distribuicao_pendente',(select not legado_distrib_importado from public.qoe_semanas where numero=1),'semanas',
   jsonb_agg(coalesce(w.fechamento,public.qoe_semanal_retrato_k165(w.numero)) order by w.numero))
 into result from public.qoe_semanas w;
 return result;
end $$;

create or replace function public.gestao_semanal_importar_distribuicao(p_marcacoes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare imported boolean; k record; tech text;
begin
 perform public.qoe_semanal_exigir_gestor_k165();perform pg_advisory_xact_lock(16501910);
 select legado_distrib_importado into strict imported from public.qoe_semanas where numero=1;
 if imported then return public.gestao_semanal_ler(); end if;
 if jsonb_typeof(p_marcacoes) is distinct from 'object' then raise exception 'Marcações inválidas.'; end if;
 for k in select * from jsonb_each(p_marcacoes) loop
   if left(k.key,2)<>'1|' then continue; end if;
   tech:=substring(k.key from 3);
   if exists(select 1 from public.tecnicos where nome=tech)
      and jsonb_typeof(k.value)='object' and (k.value->>'date') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
   then
     update public.qoe_semanas set distribuidas=case when distribuidas ? tech then distribuidas
       else jsonb_set(distribuidas,array[tech],jsonb_build_object('date',k.value->>'date','time',coalesce(k.value->>'time',''))) end
     where numero=1;
   end if;
 end loop;
 update public.qoe_semanas set legado_distrib_importado=true where numero=1;
 update public.qoe_semanas set fechamento=jsonb_set(fechamento,'{distribuidas}',distribuidas)
 where numero=1 and fechamento is not null;
 return public.gestao_semanal_ler();
end $$;

create or replace function public.gestao_semanal_iniciar(p_semana_atual integer,p_inicio date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.qoe_semanas; actor uuid; cutoff timestamptz; base jsonb;
begin
 actor:=public.qoe_semanal_exigir_gestor_k165();
 perform pg_advisory_xact_lock(16501910);
 select * into strict w from public.qoe_semanas where fechada_em is null;
 if w.numero<>p_semana_atual then raise exception 'A semana mudou em outro computador. Atualize antes de continuar.'; end if;
 if p_inicio is null or p_inicio<=w.inicio or p_inicio>(now() at time zone 'America/Sao_Paulo')::date
 then raise exception 'Data de início inválida.'; end if;
 cutoff:=p_inicio::timestamp at time zone 'America/Sao_Paulo';
 select dados into base from public.qoe_base_diaria where id=1;
 if base is null or base->>'mes' is distinct from to_char(p_inicio-1,'YYYY-MM')
 then raise exception 'Carregue a base diária do mês do fechamento antes de abrir a próxima semana.'; end if;
 -- Itens capturados depois do corte não são recebimentos da semana encerrada.
 -- Exclui somente a projeção semanal derivada; as demandas/histórico ficam intactos.
 delete from public.qoe_semana_portas where semana=w.numero and recebida_em>=cutoff;
 perform public.qoe_semanal_sync_k165(w.numero,cutoff,p_inicio-1,true);
 update public.qoe_semanas set fim=p_inicio-1,fechada_em=clock_timestamp(),fechada_por=actor where numero=w.numero;
 update public.qoe_semanas set fechamento=public.qoe_semanal_retrato_k165(w.numero) where numero=w.numero;
 insert into public.qoe_semanas(numero,inicio,aberta_por) values(w.numero+1,p_inicio,actor);

 -- Pendência inclui devolutiva aguardando validação e recorrente. Não recria demanda,
 -- não muda tecnico/status/semana de origem e não carrega monitoramento/estabilizadas.
 insert into public.qoe_semana_portas(semana,porta_id,demanda_id,tecnico_id,nova,recebida_em)
 select w.numero+1,porta_id,demanda_id,tecnico_id,false,cutoff
 from public.qoe_semana_portas where semana=w.numero and pendente;

 -- Alocações feitas desde o corte com o contador antigo também são preservadas
 -- na nova semana, sem corrigir silenciosamente demandas.semana.
 insert into public.qoe_semana_portas(semana,porta_id,demanda_id,tecnico_id,nova,recebida_em)
 select w.numero+1,d.porta_id,d.id,d.tecnico_id,true,coalesce(d.distribuida_em,d.criada_em)
 from (select distinct on(porta_id) * from public.demandas
    where semana<=w.numero and coalesce(distribuida_em,criada_em)>=cutoff
    order by porta_id,coalesce(distribuida_em,criada_em) desc,id) d
 on conflict(semana,porta_id) do nothing;
 return public.gestao_semanal_ler();
end $$;

create or replace function public.gestao_semanal_alocar(p_porta text,p_tecnico text,p_semana_esperada integer)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; demand uuid;
begin
 perform public.qoe_semanal_exigir_gestor_k165();perform pg_advisory_xact_lock(16501910);
 select numero into strict n from public.qoe_semanas where fechada_em is null;
 if n<>p_semana_esperada then raise exception 'A semana mudou. Atualize e refaça a alocação.'; end if;
 demand:=public.gestao_alocar(p_porta,p_tecnico,n);
 perform public.qoe_semanal_sync_k165(n,clock_timestamp(),(now() at time zone 'America/Sao_Paulo')::date,false);
 return demand;
end $$;

create or replace function public.gestao_semanal_distribuida(p_tecnico text,p_semana_esperada integer,p_distribuida boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 perform public.qoe_semanal_exigir_gestor_k165();perform pg_advisory_xact_lock(16501910);
 select numero into strict n from public.qoe_semanas where fechada_em is null;
 if n<>p_semana_esperada then raise exception 'A semana mudou. Atualize antes de marcar a distribuição.'; end if;
 if not exists(select 1 from public.tecnicos where nome=p_tecnico and ativo)
 then raise exception 'Técnico não localizado.'; end if;
 update public.qoe_semanas set legado_distrib_importado=true,distribuidas=case when p_distribuida then
   jsonb_set(distribuidas,array[p_tecnico],jsonb_build_object(
     'date',to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY'),
     'time',to_char(now() at time zone 'America/Sao_Paulo','HH24:MI'))) else distribuidas-p_tecnico end
 where numero=n;
 return public.gestao_semanal_ler();
end $$;

revoke all on function public.qoe_semanal_exigir_gestor_k165() from public,anon,authenticated;
revoke all on function public.qoe_semanal_sync_k165(integer,timestamptz,date,boolean) from public,anon,authenticated;
revoke all on function public.qoe_semanal_retrato_k165(integer) from public,anon,authenticated;
revoke all on function public.gestao_semanal_ler() from public,anon;
revoke all on function public.gestao_semanal_iniciar(integer,date) from public,anon;
revoke all on function public.gestao_semanal_alocar(text,text,integer) from public,anon;
revoke all on function public.gestao_semanal_distribuida(text,integer,boolean) from public,anon;
revoke all on function public.gestao_semanal_importar_distribuicao(jsonb) from public,anon;
grant execute on function public.gestao_semanal_ler() to authenticated;
grant execute on function public.gestao_semanal_iniciar(integer,date) to authenticated;
grant execute on function public.gestao_semanal_alocar(text,text,integer) to authenticated;
grant execute on function public.gestao_semanal_distribuida(text,integer,boolean) to authenticated;
grant execute on function public.gestao_semanal_importar_distribuicao(jsonb) to authenticated;
commit;
