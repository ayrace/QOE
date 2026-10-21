const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');const assert=require('node:assert/strict');
const migration=fs.readFileSync(require('node:path').join(__dirname,'../sql/01_CONTROLE_SEMANAL_K16_5.sql'),'utf8');
async function main(){
 const db=new PGlite();let checks=0;
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;console.log('OK',label);};
 await db.exec(`
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
 `);
 await db.exec(migration);await db.exec(migration);
 eq((await db.query("select count(*)::int n from qoe_semanas")).rows[0].n,1,'instalação repetida preserva semana e dados');
 await assert.rejects(db.query('select gestao_semanal_ler()'),/não autorizado/);checks++;
 await db.exec("set role anon");await assert.rejects(db.query('select * from qoe_semanas'),/permission denied/);checks++;
 await assert.rejects(db.query('select gestao_semanal_ler()'),/permission denied/);checks++;
 await db.exec("reset role;set test.actor='11111111-1111-1111-1111-111111111111';set role authenticated;");
 const read=async()=>(await db.query('select gestao_semanal_ler() x')).rows[0].x;
 let snap=await read();eq(snap.semana_atual,1,'leitura não avança semana por existir demanda com semana 2');
 eq(snap.semanas[0].tecnicos[0].recebidas,5,'cinco portas físicas recebidas');
 eq(snap.semanas[0].tecnicos[0].tratadas,1,'somente validação registrada conta produtividade');
 eq(snap.semanas[0].tecnicos[0].normalizadas,2,'antes do fechamento usa leituras atuais; atuação não normaliza');
 snap=(await db.query(`select gestao_semanal_importar_distribuicao('{"1|Ana":{"date":"10/10/2026","time":"09:00"}}') x`)).rows[0].x;
 eq(snap.semanas[0].distribuidas.Ana.date,'10/10/2026','marcações legadas da semana 1 são preservadas');
 snap=(await db.query(`select gestao_semanal_importar_distribuicao('{"1|Beto":{"date":"11/10/2026"}}') x`)).rows[0].x;
 eq(!!snap.semanas[0].distribuidas.Beto,false,'importação legada executa uma vez e não restaura marcações antigas');
 // Não altera os dados operacionais no fechamento nem nos refreshes.
 await db.exec('reset role');const original=(await db.query('select * from demandas order by id')).rows;
 await db.exec('set role authenticated');
 snap=(await db.query("select gestao_semanal_iniciar(1,'2026-10-19') x")).rows[0].x;
 eq(snap.semana_atual,2,'abre semana 2 com início em 19/10');
 let closed=snap.semanas[0],active=snap.semanas[1];
 eq(closed.tecnicos[0].normalizadas,1,'fechamento não usa leitura futura do dia 20');
 eq(closed.tecnicos[0].pendentes,3,'corte histórico preserva pendência aguardando validação');
 eq(active.tecnicos[0].novas,1,'demanda já etiquetada semana 2 é nova, herdadas não são novas');
 await db.exec('reset role');eq((await db.query('select * from demandas order by id')).rows,original,'nenhuma demanda/carteira é recriada na virada');
 eq((await db.query("select count(*)::int n from qoe_semana_portas i join portas_qoe p on p.id=i.porta_id where semana=2 and p.porta='A-4'")).rows[0].n,0,'monitoramento não retorna à carga por virada');
 await db.exec("set test.actor='22222222-2222-2222-2222-222222222222';set role authenticated");
 await assert.rejects(db.query("select gestao_semanal_iniciar(1,'2026-10-19')"),/semana mudou/);checks++;
 eq((await read()).semana_atual,2,'segundo gestor não abre semana duplicada');
 const before=JSON.stringify((await read()).semanas[0]);
 await db.query("select gestao_semanal_alocar('N-1','Ana',2)");await db.query("select gestao_semanal_alocar('N-2','Ana',2)");
 snap=await read();eq(snap.semana_atual,2,'distribuir não avança semana');
 eq(snap.semanas[1].tecnicos[0].novas,3,'novas portas são somadas manualmente');
 await db.query("select gestao_semanal_alocar('Q-1','Beto',2)");await db.query("select gestao_semanal_alocar('Q-2','Beto',2)");
 snap=await read();eq(snap.semanas[1].tecnicos[1].recebidas,7,'cinco pendentes herdadas mais duas novas resultam em sete');
 eq(snap.semanas[1].tecnicos[1].novas,2,'as cinco herdadas não contam como novas');
 eq(JSON.stringify(snap.semanas[0]),before,'histórico fechado não muda após novas alocações');
 await assert.rejects(db.query("select gestao_semanal_alocar('F-1','Ana',1)"),/semana mudou/);checks++;
 snap=(await db.query("select gestao_semanal_distribuida('Ana',2,true) x")).rows[0].x;
 eq(!!snap.semanas[1].distribuidas.Ana,true,'distribuída persiste para todos os gestores');
 eq(snap.semana_atual,2,'marcar distribuída não avança semana');
 await db.exec(`reset role;
 insert into portas_qoe(porta,nota_atual) values('LEG-1',70);
 insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em)
 select p.id,t.id,'PENDENTE',1,now() from portas_qoe p cross join tecnicos t where p.porta='LEG-1' and t.nome='Beto';
 set role authenticated;`);
 snap=await read();eq(snap.semanas[1].tecnicos[1].recebidas,8,'alocação por navegador antigo entra na semana compartilhada pela data');
 // Retorno após atuação e atualização de leitura não apagam tratamento histórico.
 await db.exec(`reset role;
 update demandas set status='RECORRENTE' where porta_id=(select id from portas_qoe where porta='A-3');
 update portas_qoe set nota_atual=99;
 set role authenticated;`);
 snap=await read();eq(JSON.stringify(snap.semanas[0]),before,'retorno não recalcula fechamento da semana 1');
 await db.exec('reset role');eq((await db.query("select pg_get_function_result('qoe_gestor_atual()'::regprocedure) r")).rows[0].r,'uuid','qoe_gestor_atual continua UUID');
 await db.close();console.log(checks+' verificações SQL passaram.');
}
main().catch(e=>{console.error(e);process.exit(1);});
