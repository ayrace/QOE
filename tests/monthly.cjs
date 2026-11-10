const {PGlite}=require('@electric-sql/pglite');const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..');
async function main(){
 const db=new PGlite();let count=0;const eq=(x,y,label)=>{assert.deepEqual(x,y,label);count++;console.log('OK',label);};
 const fixture=fs.readFileSync(path.join(__dirname,'fixtures/base-operacional.sql'),'utf8');
 await db.exec(fixture);
 await db.exec(`
 create schema auth;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 alter table historico add origem text,add usuario_nome text;alter table historico alter criado_em set default now();
 alter table tratativas add tipo_atuacao text default 'MANUTENCAO_COAXIAL',add descricao text,add endereco_ofensor text,add observacao text;
 alter table tratativas alter criado_em set default now();
 alter table tecnicos add token_acesso uuid default gen_random_uuid();
 create table monitoramento(demanda_id uuid,data_leitura date,nota numeric,referencia text);
 create function gestao_salvar_base_diaria(p_payload jsonb) returns jsonb language plpgsql as $$begin
 insert into qoe_base_diaria values(1,p_payload) on conflict(id) do update set dados=excluded.dados;return '{}'::jsonb;end$$;
 create function gestao_registrar_tratativa(p_porta text,p_gestor_nome text,p_tipo text,p_descricao text,p_endereco text,p_observacao text)
 returns uuid language plpgsql as $$declare id_tr uuid;d uuid;begin select demandas.id into d from demandas join portas_qoe p on p.id=porta_id where p.porta=p_porta order by criada_em desc limit 1;
 insert into tratativas(demanda_id,tipo_atuacao,descricao,endereco_ofensor,observacao) values(d,p_tipo,p_descricao,p_endereco,p_observacao) returning id into id_tr;
 update demandas set status='ATUACAO_REGISTRADA' where id=d;return id_tr;end$$;
 create function portal_tecnico_registrar_atuacao(p_token uuid,p_demanda uuid,p_tipo text,p_descricao text,p_endereco text,p_observacao text)
 returns uuid language plpgsql as $$declare tr uuid;begin
 if not exists(select 1 from demandas d join tecnicos t on t.id=d.tecnico_id where d.id=p_demanda and t.token_acesso=p_token and d.status='PENDENTE') then raise exception 'Não autorizado';end if;
 insert into tratativas(demanda_id,tipo_atuacao,descricao,endereco_ofensor,observacao) values(p_demanda,p_tipo,p_descricao,p_endereco,p_observacao) returning id into tr;
 update demandas set status='ATUACAO_REGISTRADA' where id=p_demanda;return tr;end$$;
 create function portal_tecnico_carteira(p_token uuid) returns table(demanda_id uuid,porta text,tecnico text,status text,nota_atual numeric)
 language sql as $$select d.id,p.porta,t.nome,d.status,p.nota_atual from demandas d join portas_qoe p on p.id=d.porta_id join tecnicos t on t.id=d.tecnico_id where t.token_acesso=p_token and d.status<>'ENCERRADA'$$;
 create function gestao_snapshot() returns jsonb language sql as $$select jsonb_build_object(
 'demandas',(select jsonb_agg(jsonb_build_object('demanda_id',d.id,'porta',p.porta,'tecnico',t.nome,'status',d.status)) from demandas d join portas_qoe p on p.id=d.porta_id join tecnicos t on t.id=d.tecnico_id where d.status<>'ENCERRADA'),
 'tratativas',(select jsonb_agg(jsonb_build_object('id',id,'demanda_id',demanda_id,'criado_em',criado_em,'tipo',tipo_atuacao,'descricao',descricao,'endereco',endereco_ofensor)) from tratativas))$$;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/controle-semanal-k165.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/QOE_SUPABASE_K6_VALIDAR_OU_DEVOLVER.sql'),'utf8'));
 const migration=fs.readFileSync(path.join(root,'00_PRE_REQUISITO_K17_1.sql'),'utf8');
 const beforeDefs=(await db.query("select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname in ('qoe_gestor_atual','gestao_validar_atuacao','gestao_semanal_ler') order by proname")).rows;
 await db.exec(migration);await db.exec(fs.readFileSync(path.join(root,'01_SUPABASE_K17_2.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(root,'01_SUPABASE_K17_2.sql'),'utf8'));
 eq((await db.query("select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname in ('qoe_gestor_atual','gestao_validar_atuacao','gestao_semanal_ler') order by proname")).rows,beforeDefs,'funções existentes, incluindo UUID, permanecem idênticas');
 await assert.rejects(db.query('select gestao_snapshot_k17()'),/não autorizado/);count++;
 await db.exec('set role anon');await assert.rejects(db.query('select * from qoe_leituras_hfc'),/permission denied/);count++;
 await db.exec("reset role;set test.actor='11111111-1111-1111-1111-111111111111'");
 const token=(await db.query("select token_acesso from tecnicos where nome='Ana'")).rows[0].token_acesso;
 async function demand(port){return (await db.query(`insert into portas_qoe(porta,nota_atual) values($1,70) returning id`,[port])).rows[0].id;}
 async function action(port,date){const p=await demand(port);const d=(await db.query("insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) select $1,id,'PENDENTE',2,'2026-10-01' from tecnicos where nome='Ana' returning id",[p])).rows[0].id;
  const tr=(await db.query("select portal_tecnico_registrar_atuacao_k17($1,$2,'MDU','Executado','1. Original | 2. Adicional',null,$3) id",[token,d,'2099-01-01T00:00:00Z'])).rows[0].id;
  const recorded=(await db.query('select criado_em from tratativas where id=$1',[tr])).rows[0].criado_em;assert.ok(Math.abs(Date.now()-new Date(recorded))<10000,'RPC usa timestamp do banco, ignora data passada pelo cliente');
  /* Simula registros históricos: só a fixture altera criado_em. */
  await db.query('update tratativas set criado_em=$1 where id=$2',[date,tr]);await db.query('select qoe_k172_sincronizar_registros()');return {d,tr,p};}
 async function notes(port,obj,month='2026-10'){return db.query('select gestao_salvar_base_diaria_k17($1)',[{mes:month,oct:{[port]:[port.split('-')[0],obj]}}]);}
 async function validate(x){return (await db.query('select gestao_validar_atuacao_k17($1,$2) x',[x.d,x.tr])).rows[0].x;}

 const monthSql=fs.readFileSync(path.join(root,'02_SUPABASE_MENSAL_K18.sql'),'utf8');
 const tables=['demandas','tratativas','historico','qoe_semanas','qoe_semana_portas','qoe_base_diaria'];
 async function fingerprint(){const result={};for(const t of tables)result[t]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') x from ${t} x`)).rows[0].x;return result;}
 const beforeMigration=await fingerprint();await db.exec(monthSql);
 eq(await fingerprint(),beforeMigration,'migração mensal não altera nenhuma demanda, atuação, histórico, semana ou base diária');
 const first=(await db.query("select mes::text from qoe_meses where fechado_em is null")).rows[0].mes;
 eq(first,'2026-11-01','novembro é o mês aberto sem depender de semana antiga');
 const archive=(await db.query('select legado_semanal from qoe_meses')).rows[0].legado_semanal;
 await db.exec(monthSql);eq(await fingerprint(),beforeMigration,'reaplicar migração não duplica nem redistribui portas');
 eq((await db.query('select count(*)::int n from qoe_meses')).rows[0].n,1,'somente um mês aberto');
 await db.exec('set role anon');await assert.rejects(db.query('select * from qoe_meses'),/permission denied/);count++;
 await assert.rejects(db.query('select gestao_mensal_ler_k18()'),/permission denied/);count++;
 await db.exec("reset role;set test.actor=''");await assert.rejects(db.query('select gestao_mensal_ler_k18()'),/não autorizado/);count++;
 await db.exec("set test.actor='11111111-1111-1111-1111-111111111111'");
 // Cria exemplos novos exclusivamente na fixture, sem alterar produção.
 const pp=await demand('MONTH-NEW-1');const defs=(await db.query("select pg_get_functiondef('qoe_gestor_atual()'::regprocedure) d")).rows[0].d;
 const owners=(await db.query('select id,tecnico_id,status,semana from demandas order by id')).rows;
 const newId=(await db.query("select gestao_mensal_alocar_k18('MONTH-NEW-1','Beto','2026-11-01') id")).rows[0].id;
 eq((await db.query('select id,tecnico_id,status,semana from demandas where id<>$1 order by id',[newId])).rows,owners,'alocação manual mensal preserva carteiras anteriores');
 await assert.rejects(db.query("select gestao_mensal_alocar_k18('MONTH-NEW-1','Ana','2026-11-01')"),/demanda ativa/);count++;
 await assert.rejects(db.query("select gestao_mensal_alocar_k18('MONTH-NEW-1','Ana','2026-12-01')"),/mês mudou/);count++;
 eq((await db.query("select count(*)::int n from demandas where porta_id=$1",[pp])).rows[0].n,1,'dois cliques ou redistribuição não criam demanda ativa duplicada');
 // Novembro, aprovação posterior: ação do registro original pertence ao mês.
 const mp=await demand('MONTH-ACT-1');const md=(await db.query("insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) select $1,id,'PENDENTE',1,'2026-10-15' from tecnicos where nome='Ana' returning id",[mp])).rows[0].id;
 const mt=(await db.query("insert into tratativas(demanda_id,tipo_atuacao,criado_em,endereco_ofensor) values($1,'MDU','2026-11-01T12:00:00-03:00','Original | Adicional') returning id",[md])).rows[0].id;
 await db.query("update demandas set status='ATUACAO_REGISTRADA' where id=$1",[md]);
 // Bootstrap foi feito antes desse exemplo; importa a pendência como no avanço de mês.
 await db.query("insert into qoe_mes_carteira(mes,demanda_id,porta_id,tecnico_id,nova,recebida_em) select '2026-11-01',id,porta_id,tecnico_id,false,'2026-11-01' from demandas where id=$1",[md]);
 await notes('MONTH-ACT-1',{'2':70},'2026-11');await db.query('select gestao_validar_atuacao_k17($1,$2)',[md,mt]);
 let rep=(await db.query("select gestao_mensal_relatorio_k18('2026-11-01') x")).rows[0].x;
 eq(rep.tecnicos.find(t=>t.tecnico==='Ana').atuadas,1,'relatório mensal conta pela data do registro, sem considerar número da semana');
 eq(rep.tecnicos.find(t=>t.tecnico==='Ana').retornos,1,'resultado mensal conserva retorno imediato por QoE abaixo de 80');
 eq(rep.tecnicos.find(t=>t.tecnico==='Ana').assertividade,0,'assertividade mensal separada de execução');
 eq(rep.tecnicos.find(t=>t.tecnico==='Beto').sem_atuacao,true,'técnico com pendências sem atuação no mês destacado para cobrança');
 const demandsN=(await db.query('select count(*)::int n from demandas')).rows[0].n;
 await notes('MONTH-NEW-1',{'3':90},'2026-11');let payload=(await db.query('select gestao_mensal_ler_k18() x')).rows[0].x;
 eq((await db.query('select count(*)::int n from demandas')).rows[0].n,demandsN,'importação diária e leitura mensal nunca distribuem portas');
 eq(payload.semanas_legadas,archive,'histórico semanal congelado na migração continua consultável');
 rep=payload.meses.find(m=>m.mes==='2026-11');const br=rep.tecnicos.find(t=>t.tecnico==='Beto');
 eq(br.normalizadas,1,'normalização sem atuação separada da produtividade');
 eq(br.novas,1,'nova porta normalizada permanece no recebido do mês');
 await notes('MONTH-NEW-1',{'4':60},'2026-11');await db.query('select gestao_mensal_ler_k18()');
 eq((await db.query('select portal_tecnico_carteira_k17($1) x',[(await db.query("select token_acesso from tecnicos where nome='Beto'")).rows[0].token_acesso])).rows[0].x.some(d=>d.demanda_id===newId),false,'queda de observação não reativa carteira automaticamente no mensal');
 const beforeMark=(await db.query('select count(*)::int n from demandas')).rows[0].n;
 await db.query("select gestao_mensal_distribuida_k18('Beto','2026-11-01',true)");
 eq((await db.query("select distribuidas ? 'Beto' b from qoe_meses where mes='2026-11-01'")).rows[0].b,true,'marcação de lista é compartilhada por mês');
 eq((await db.query('select count(*)::int n from demandas')).rows[0].n,beforeMark,'marcar distribuída não aloca nem avança mês');
 // Demandas duplicadas são sinalizadas, não apagadas. Resumo global conta porta distinta.
 await db.query("insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) select porta_id,tecnico_id,'PENDENTE',2,'2026-11-02' from demandas where id=$1",[md]);
 rep=(await db.query("select gestao_mensal_relatorio_k18('2026-11-01') x")).rows[0].x;
 eq(rep.conflitos.some(x=>x.porta==='MONTH-ACT-1'),true,'duplicidades ativas aparecem como conflito sem limpeza destrutiva');
 eq(rep.tecnicos.find(t=>t.tecnico==='Ana').recebidas,rep.tecnicos.find(t=>t.tecnico==='Ana').herdadas+rep.tecnicos.find(t=>t.tecnico==='Ana').novas,'porta não duplica recebimento do técnico ao haver duas demandas');

 // Quantidade é livre: mais portas escolhidas manualmente, sem completar até cinco.
 for(let k=1;k<=7;k++){await demand('FREE-'+k);await db.query("select gestao_mensal_alocar_k18($1,'Beto','2026-11-01')",['FREE-'+k]);}
 const free=(await db.query("select count(*)::int n from demandas d join portas_qoe p on p.id=d.porta_id where p.porta like 'FREE-%' and d.status='PENDENTE'")).rows[0].n;
 eq(free,7,'sete novas portas manuais são aceitas sem limite de cinco');
 const transferable=(await db.query("select d.id,d.tecnico_id from demandas d join portas_qoe p on p.id=d.porta_id where p.porta='FREE-1'")).rows[0];
 const changed=(await db.query("select gestao_mensal_alocar_k18('FREE-1','Ana','2026-11-01',true) id")).rows[0].id;
 eq((await db.query('select status from demandas where id=$1',[transferable.id])).rows[0].status,'ENCERRADA','transferência manual explícita conserva demanda de origem encerrada');
 eq((await db.query('select tecnico_id from demandas where id=$1',[transferable.id])).rows[0].tecnico_id,transferable.tecnico_id,'transferência não reatribui o histórico ao novo técnico');
 eq((await db.query("select count(*)::int n from qoe_mes_carteira i join portas_qoe p on p.id=i.porta_id where p.porta='FREE-1'")).rows[0].n,2,'recebimentos dos dois técnicos ficam preservados na transferência');
 // Acompanhamento herdado de outubro retorna em novembro depois da migração.
 const latep=await demand('LATERET-1');const lated=(await db.query("insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) select $1,id,'MONITORAMENTO',1,'2026-10-01' from tecnicos where nome='Ana' returning id",[latep])).rows[0].id;
 await db.query("insert into historico(porta_id,demanda_id,evento,criado_em) values($1,$2,'MONITORAMENTO_RETORNO_TRATAMENTO','2026-11-02')",[latep,lated]);
 await db.query("update demandas set status='PENDENTE' where id=$1",[lated]);
 rep=(await db.query("select gestao_mensal_relatorio_k18('2026-11-01') x")).rows[0].x;
 eq(rep.tecnicos.find(t=>t.tecnico==='Ana').portas_pendentes.includes('LATERET-1'),true,'retorno após a migração entra no mês com demanda e técnico originais');
 const itemsBeforeClose=(await db.query('select count(*)::int n from demandas')).rows[0].n;
 await db.query('select gestao_mensal_ler_k18()');
 eq((await db.query('select count(*)::int n from demandas')).rows[0].n,itemsBeforeClose,'retorno ao mês é projeção de carteira, não nova distribuição');
 await assert.rejects(db.query("select gestao_mensal_iniciar_k18('2026-11-01')"),/ainda não começou/);count++;
 // Testa virada com mês passado real: outubro -> novembro, sem simular relógio de produção.
 await db.exec("delete from qoe_mes_carteira;delete from qoe_meses;insert into qoe_meses(mes) values('2026-10-01')");
 await db.query("select qoe_mensal_sync_k18('2026-10-01','2026-11-01T03:00:00Z')");
 const beforeAdvance=(await db.query('select id,tecnico_id,status,semana from demandas order by id')).rows;
 const advanced=(await db.query("select gestao_mensal_iniciar_k18('2026-10-01') x")).rows[0].x;
 eq(advanced.mes_atual,'2026-11','abertura explícita avança exatamente um mês');
 eq((await db.query('select id,tecnico_id,status,semana from demandas order by id')).rows,beforeAdvance,'virada de mês não altera demandas, técnicos, status nem semana de origem');
 const inherited=(await db.query("select count(*)::int n from qoe_mes_carteira where mes='2026-11-01' and not nova")).rows[0].n;
 assert.ok(inherited>0);count++;console.log('OK pendências anteriores carregadas sem recriar demandas');
 const frozen=(await db.query("select fechamento from qoe_meses where mes='2026-10-01'")).rows[0].fechamento;
 await db.query("select gestao_mensal_ler_k18()");eq((await db.query("select fechamento from qoe_meses where mes='2026-10-01'")).rows[0].fechamento,frozen,'recebimento fechado não é reescrito por consultas posteriores');
 await assert.rejects(db.query("select gestao_mensal_iniciar_k18('2026-10-01')"),/outro computador/);count++;
 eq((await db.query("select pg_get_functiondef('qoe_gestor_atual()'::regprocedure) d")).rows[0].d,defs,'qoe_gestor_atual e retorno UUID permanecem intocados');
 await db.close();console.log(count+' verificações mensais passaram.');
}
main().catch(e=>{console.error(e);process.exit(1);});
