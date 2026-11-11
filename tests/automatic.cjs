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

 await db.exec(fs.readFileSync(path.join(root,'02_SUPABASE_MENSAL_K18.sql'),'utf8'));
 await db.exec(`
 create table gestores(id uuid primary key,nome text);insert into gestores values('11111111-1111-1111-1111-111111111111','Gestor');
 create table demandas_secundarias(id uuid primary key default gen_random_uuid(),demanda_origem_id uuid not null references demandas(id),tratativa_origem_id uuid references tratativas(id),tipo text,endereco text,descricao text,status text not null default 'NOVA',criada_em timestamptz default now(),atualizada_em timestamptz default now());
 -- Simula os efeitos antigos após INSERT: status e secundária automática.
 create function fixture_after_tr() returns trigger language plpgsql as $$begin
 update demandas set status='ATUACAO_REGISTRADA' where id=new.demanda_id;
 if new.tipo_atuacao in ('MDU','INDOOR') then insert into demandas_secundarias(demanda_origem_id,tratativa_origem_id,tipo,endereco,descricao) values(new.demanda_id,new.id,new.tipo_atuacao,new.endereco_ofensor,new.descricao);end if;
 return new;end$$;
 create trigger fixture_tr after insert on tratativas for each row execute function fixture_after_tr();
 `);
 const migration19=fs.readFileSync(path.join(root,'01_SUPABASE_K19_AUTOMATICO_MDU.sql'),'utf8');
 const before=(await db.query('select jsonb_agg(to_jsonb(d) order by id) x from demandas d')).rows[0].x;
 await db.exec(migration19);await db.exec(migration19);
 eq((await db.query('select jsonb_agg(to_jsonb(d) order by id) x from demandas d')).rows[0].x,before,'instalar e reaplicar não altera carteiras/atuações históricas antes da leitura de migração');
 await db.exec('set role anon');await assert.rejects(db.query('select * from qoe_mdu_enderecos_k19'),/permission denied/);count++;
 await assert.rejects(db.query("select qoe_k19_processar('00000000-0000-0000-0000-000000000000')"),/permission denied/);count++;
 await assert.rejects(db.query('select gestao_mdu_ler_k19()'),/permission denied/);count++;
 await db.exec('reset role');
 async function make(port,tech='Ana'){const p=await demand(port);const d=(await db.query("insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) select $1,id,'PENDENTE',4,'2026-10-01' from tecnicos where nome=$2 returning id",[p,tech])).rows[0].id;return {p,d};}
 async function register(x,type='MANUTENCAO_COAXIAL',purpose='EXECUTADA',addr=null){await db.exec('set role anon');const v=(await db.query('select portal_tecnico_registrar_atuacao_k19($1,$2,$3,$4,$5,null,$6) x',[token,x.d,type,'Executado/identificado',addr,purpose])).rows[0].x;await db.exec('reset role');return v;}
 const a=await make('AUTO-1');const owner=(await db.query('select tecnico_id from demandas where id=$1',[a.d])).rows[0].tecnico_id;
 let response=await register(a);eq(response.status,'MONITORAMENTO','técnico registra atuação executada e entra em acompanhamento sem gestor');
 const atr=response.tratativa_id;
 eq((await db.query('select atuada_em=(select criado_em from tratativas where id=$1) same from qoe_contexto_atuacao where tratativa_id=$1',[atr])).rows[0].same,true,'contagem automática usa registro original');
 eq((await db.query("select detalhes->>'modo' modo from historico where demanda_id=$1 and evento='ATUACAO_VALIDADA'",[a.d])).rows[0].modo,'AUTOMATICO','histórico distingue aceite automático de aprovação humana');
 await db.query("update tratativas set criado_em='2026-11-01T12:00:00-03:00' where id=$1",[atr]);await notes('AUTO-1',{'2':70},'2026-11');
 response=(await db.query('select gestao_processar_monitoramento_k17($1) x',[a.d])).rows[0].x;
 eq(response.status,'PENDENTE','leitura real posterior abaixo de 80 retorna sem esperar sete dias');
 eq(response.mensagem,'QoE abaixo de 80 após atuação. Necessário continuar o tratamento.','mensagem usa exatamente o texto aprovado');
 eq((await db.query('select tecnico_id from demandas where id=$1',[a.d])).rows[0].tecnico_id,owner,'retorno mantém o mesmo técnico');
 let carteira=(await db.query('select portal_tecnico_carteira_k19($1) x',[token])).rows[0].x;
 eq(carteira.find(x=>x.demanda_id===a.d).retorno_tratamento.mensagem,response.mensagem,'Portal recebe mensagem e motivo da porta devolvida');
 eq(Number(carteira.find(x=>x.demanda_id===a.d).retorno_tratamento.nota),70,'aviso inclui leitura real que motivou o retorno');
 const good=await make('AUTOGOOD-1');const g=await register(good);
 await db.query("update tratativas set criado_em='2026-11-01T12:00:00-03:00' where id=$1",[g.tratativa_id]);await notes('AUTOGOOD-1',Object.fromEntries([2,3,4,5,6,7,8].map(d=>[d,85])),'2026-11');
 eq((await db.query('select gestao_processar_monitoramento_k17($1) x',[good.d])).rows[0].x.status,'ESTABILIZADA','sete dias consecutivos bons continuam estabilizando automaticamente');
 const support=await make('SUPPORT-1');let sup=await register(support,'NECESSITA_APOIO','EXECUTADA');
 eq(sup.status,'PENDENTE','pedido de apoio não entra em acompanhamento');
 eq((await db.query('select validada_em from qoe_contexto_atuacao where tratativa_id=$1',[sup.tratativa_id])).rows[0].validada_em,null,'apoio não recebe aceite de execução');
 const m=await make('MDULIST-1');let enc=await register(m,'MDU','ENCAMINHAMENTO','1. Rua original 10 | 2. Rua adicional 20 | 3. Rua terceira 30');
 eq(enc.status,'PENDENTE','encaminhamento MDU permanece pendente, sem presumir execução');
 let rows=(await db.query('select gestao_mdu_ler_k19() x')).rows[0].x.filter(x=>x.demanda_origem_id===m.d);
 eq(rows.length,3,'três endereços viram três itens da mesma ocorrência');
 eq(rows.map(r=>r.endereco),['Rua original 10','Rua adicional 20','Rua terceira 30'],'ordem e conteúdo de todos os endereços preservados');
 eq((await db.query('select endereco_ofensor from tratativas where id=$1',[enc.tratativa_id])).rows[0].endereco_ofensor,'1. Rua original 10 | 2. Rua adicional 20 | 3. Rua terceira 30','endereço original da tratativa não é substituído');
 await db.query('select gestao_mdu_ler_k19()');eq((await db.query('select count(*)::int n from qoe_mdu_enderecos_k19 where secundaria_id=$1',[rows[0].secundaria_id])).rows[0].n,3,'atualizações não duplicam itens MDU');
 for(const row of rows)await db.query("select gestao_mdu_direcionar_k19($1,'Equipe MDU',1)",[row.id]);
 await assert.rejects(db.query("select gestao_mdu_direcionar_k19($1,'Outro',1)",[rows[0].id]),/outro computador/);count++;
 response=(await db.query("select gestao_mdu_executar_k19($1,'Endereço atendido',2) x",[rows[0].id])).rows[0].x;
 eq(response.pendentes,2,'executar um endereço não encerra os outros');
 eq((await db.query('select status from demandas where id=$1',[m.d])).rows[0].status,'PENDENTE','porta não entra em acompanhamento com endereço ainda pendente');
 await db.query("select gestao_mdu_executar_k19($1,'Endereço atendido',2)",[rows[1].id]);
 response=(await db.query("select gestao_mdu_executar_k19($1,'Último endereço atendido',2) x",[rows[2].id])).rows[0].x;
 eq(response.status,'MONITORAMENTO','última execução MDU inicia acompanhamento automaticamente');
 eq((await db.query('select tecnico_id from demandas where id=$1',[m.d])).rows[0].tecnico_id,owner,'execução MDU conserva demanda e técnico de origem');
 rows=(await db.query('select gestao_mdu_ler_k19() x')).rows[0].x.filter(x=>x.demanda_origem_id===m.d);
 eq(rows.every(r=>r.situacao==='EXECUTADO'),true,'trigger antigo não cria nova pendência artificial após conclusão MDU');eq(rows.length,3,'execução agregada não duplica os endereços individuais na nova lista');
 const rep=(await db.query("select gestao_mensal_relatorio_k18('2026-11-01') x")).rows[0].x;
 eq(rep.tecnicos.find(t=>t.tecnico==='Ana').atuadas,3,'produtividade conta duas atuações HFC e uma execução MDU, exclui apoio e encaminhamento');
 const exec=await make('MDUEXEC-1');response=await register(exec,'MDU','EXECUTADA','1. Endereço executado');eq(response.status,'MONITORAMENTO','técnico pode informar MDU já executado explicitamente');
 rows=(await db.query('select gestao_mdu_ler_k19() x')).rows[0].x.filter(x=>x.demanda_origem_id===exec.d);eq(rows.every(r=>r.situacao==='EXECUTADO'),true,'registro MDU executado não volta como tarefa pendente');
 const manual=await make('MANUALMDU-1');const demCount=(await db.query('select count(*)::int n from demandas')).rows[0].n;
 const sec=(await db.query("select gestao_mdu_cadastrar_k19($1,'MDU',$2,'Verificar ofensor') id",[manual.d,['Rua A','Rua B']])).rows[0].id;
 eq((await db.query('select count(*)::int n from demandas')).rows[0].n,demCount,'cadastro manual MDU não distribui nem recria porta');
 eq((await db.query('select count(*)::int n from qoe_mdu_enderecos_k19 where secundaria_id=$1',[sec])).rows[0].n,2,'cadastro manual aceita múltiplos endereços vinculados à origem');
 // Migração de registros já pendentes: MDU continua encaminhamento e HFC executado segue.
 const old=await make('OLDWAIT-1');const oldtr=(await db.query("insert into tratativas(demanda_id,tipo_atuacao,descricao) values($1,'MANUTENCAO_COAXIAL','Executado anteriormente') returning id",[old.d])).rows[0].id;
 await db.query('select gestao_snapshot_k19()');eq((await db.query('select status from demandas where id=$1',[old.d])).rows[0].status,'MONITORAMENTO','devolutiva antiga HFC pendente de aprovação passa ao fluxo automático');
 eq((await db.query('select endereco from demandas_secundarias where id=$1',[sec])).rows[0].endereco,'1. Rua A | 2. Rua B','fila mantém texto original junto aos endereços individuais');
 await assert.rejects(db.query("select portal_tecnico_registrar_atuacao_k19('00000000-0000-0000-0000-000000000000',$1,'MANUTENCAO_COAXIAL','x',null,null,'EXECUTADA')",[manual.d]),/não autorizada/);count++;
 eq((await db.query("select pg_get_function_result('qoe_gestor_atual()'::regprocedure) r")).rows[0].r,'uuid','gestor UUID preservado');

 // Um número seguido de ponto pode fazer parte do endereço e não é removido fora de lista numerada.
 await db.query("insert into demandas_secundarias(demanda_origem_id,tipo,endereco,descricao) values($1,'MDU','123. Alameda preservada','Legado')",[manual.d]);
 rows=(await db.query('select gestao_mdu_ler_k19() x')).rows[0].x;
 eq(rows.some(x=>x.endereco==='123. Alameda preservada'),true,'endereço numérico legado não perde o número');
 const norm=await make('NORMMDU-1');const nenc=await register(norm,'MDU','ENCAMINHAMENTO','1. Rua normalizada');
 await notes('NORMMDU-1',{'3':90},'2026-11');await db.query('select gestao_snapshot_k19()');
 eq((await db.query('select count(*)::int n from qoe_observacao_carteira where demanda_id=$1',[norm.d])).rows[0].n,1,'encaminhamento sem execução não impede a observação pré-atuação');
 let nr=(await db.query('select gestao_mdu_ler_k19() x')).rows[0].x.find(x=>x.demanda_origem_id===norm.d);
 await db.query("select gestao_mdu_direcionar_k19($1,'MDU',1)",[nr.id]);
 let nex=(await db.query("select gestao_mdu_executar_k19($1,'Ofensor corrigido',2) x",[nr.id])).rows[0].x;
 await db.query("update tratativas set criado_em='2026-11-03T12:00:00-03:00' where id=$1",[nex.tratativa_id]);await notes('NORMMDU-1',{'4':70},'2026-11');
 await db.query('select gestao_processar_monitoramento_k17($1)',[norm.d]);
 carteira=(await db.query('select portal_tecnico_carteira_k19($1) x',[token])).rows[0].x;
 eq(carteira.some(d=>d.demanda_id===norm.d),true,'execução posterior à observação permite retorno à carteira do mesmo técnico');
 let msnap=(await db.query('select gestao_snapshot_k19() x')).rows[0].x;
 eq(msnap.demandas.find(d=>d.demanda_id===norm.d).observacao_pre_atuacao,false,'Gestão também mantém visível retorno pós-execução de porta antes observada');
 eq(msnap.demandas.find(d=>d.demanda_id===norm.d).retorno_tratamento.mensagem,'QoE abaixo de 80 após atuação. Necessário continuar o tratamento.','Gestão recebe a mesma mensagem aprovada do Portal');
 const evs=(await db.query("select count(*)::int n from historico where demanda_id=$1 and evento='ATUACAO_VALIDADA'",[norm.d])).rows[0].n;
 await db.query("select qoe_k19_finalizar_registro($1,'EXECUTADA','TESTE')",[nex.tratativa_id]);
 eq((await db.query("select count(*)::int n from historico where demanda_id=$1 and evento='ATUACAO_VALIDADA'",[norm.d])).rows[0].n,evs,'reprocessamento idempotente não duplica aceite ou reinicia contagem');
 await assert.rejects(db.query("select portal_tecnico_registrar_atuacao_k19($1,$2,'MDU','x',null,null,'EXECUTADA')",[token,manual.d]),/endereço/);count++;

 await db.exec('alter table tratativas disable trigger fixture_tr');
 const noTrigger=await make('NOTRIGGER-1');await register(noTrigger,'MDU','EXECUTADA','1. Endereço sem trigger legado');
 rows=(await db.query('select gestao_mdu_ler_k19() x')).rows[0].x.filter(x=>x.demanda_origem_id===noTrigger.d);
 eq(rows.length,1,'MDU executado também é listado quando não há trigger de secundária');eq(rows[0].situacao,'EXECUTADO','integração não depende do trigger para marcar execução MDU');
 await db.exec('alter table tratativas enable trigger fixture_tr');

 await db.query("update demandas set status='ENCERRADA' where id=$1",[exec.d]);
 msnap=(await db.query('select gestao_snapshot_k19() x')).rows[0].x;
 eq(msnap.tratativas.find(t=>t.demanda_id===exec.d).porta,'MDUEXEC-1','devolutiva de demanda encerrada mantém a porta no histórico completo');
 eq(msnap.tratativas.find(t=>t.demanda_id===exec.d).tecnico,'Ana','histórico encerrado mantém o técnico de origem');
 await db.close();console.log(count+' verificações K19 passaram.');
}
main().catch(e=>{console.error(e);process.exit(1);});
