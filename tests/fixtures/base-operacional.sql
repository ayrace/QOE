
 create role anon;create role authenticated;
 create table portas_qoe(id uuid primary key default gen_random_uuid(),porta text unique,nota_atual numeric);
 create table tecnicos(id uuid primary key default gen_random_uuid(),nome text,ativo boolean default true);
 create table demandas(id uuid primary key default gen_random_uuid(),porta_id uuid references portas_qoe,
 tecnico_id uuid references tecnicos,gestor_id uuid,status text,semana int,distribuida_em timestamptz,criada_em timestamptz default now(),encerrada_em timestamptz);
 create table tratativas(id uuid primary key default gen_random_uuid(),demanda_id uuid,criado_em timestamptz);
 create table historico(id bigint generated always as identity,porta_id uuid,demanda_id uuid,evento text,detalhes jsonb,criado_em timestamptz);
 create table qoe_base_diaria(id smallint primary key,dados jsonb);
 create function qoe_gestor_atual() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function gestao_alocar(p_porta text,p_tecnico text,p_semana integer) returns uuid language plpgsql as $$
 declare p uuid;t uuid;d uuid;
 begin
 select id into strict p from portas_qoe where porta=p_porta;select id into strict t from tecnicos where nome=p_tecnico;
 update demandas set status='ENCERRADA',encerrada_em=now() where porta_id=p and status<>'ENCERRADA';
 insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) values(p,t,'PENDENTE',p_semana,now()) returning id into d;
 return d;end $$;
 insert into tecnicos(nome) values('Ana'),('Beto');
 insert into portas_qoe(porta,nota_atual) values ('A-1',70),('A-2',90),('A-3',90),('A-4',75),('B-1',70),('B-2',75),('N-1',70),('N-2',70),('F-1',70);
 insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em,criada_em)
 select p.id,t.id,case p.porta when 'A-3' then 'ATUACAO_REGISTRADA' when 'A-4' then 'MONITORAMENTO' else 'PENDENTE' end,
 case when p.porta='B-2' then 2 else 1 end,'2026-10-10 15:00Z','2026-10-10 15:00Z'
 from portas_qoe p cross join tecnicos t where t.nome='Ana' and p.porta not in ('N-1','N-2','F-1');
 insert into historico(porta_id,demanda_id,evento,criado_em)
 select porta_id,id,'ALOCACAO','2026-10-10 15:00Z' from demandas;
 insert into tratativas(demanda_id,criado_em) select d.id,'2026-10-15 15:00Z' from demandas d join portas_qoe p on p.id=d.porta_id where p.porta in ('A-3','A-4');
 insert into historico(porta_id,demanda_id,evento,criado_em)
 select d.porta_id,d.id,'ATUACAO_REGISTRADA','2026-10-15 15:00Z' from demandas d join portas_qoe p on p.id=d.porta_id where p.porta in ('A-3','A-4');
 insert into historico(porta_id,demanda_id,evento,criado_em)
 select d.porta_id,d.id,'ATUACAO_VALIDADA','2026-10-16 15:00Z' from demandas d join portas_qoe p on p.id=d.porta_id where p.porta='A-4';
 insert into portas_qoe(porta,nota_atual) select 'P-'||g,70 from generate_series(1,5) g;
 insert into portas_qoe(porta,nota_atual) values('Q-1',70),('Q-2',70);
 insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em,criada_em)
 select p.id,t.id,'PENDENTE',1,'2026-10-10 15:00Z','2026-10-10 15:00Z'
 from portas_qoe p cross join tecnicos t where p.porta like 'P-%' and t.nome='Beto';
 insert into qoe_base_diaria values(1,'{"mes":"2026-10","oct":{"A-1":["A",{"18":70,"20":90}],"A-2":["A",{"18":90,"20":90}],"A-3":["A",{"18":90,"20":90}],"A-4":["A",{"18":75,"20":75}],"B-1":["B",{"18":70,"20":70}],"B-2":["B",{"18":75,"20":75}]}}');
 