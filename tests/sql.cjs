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
 let a=await action('LATE-1','2026-10-27T12:00:00-03:00');await notes('LATE-1',{'28':70,'29':90});
 const owner=(await db.query('select tecnico_id from demandas where id=$1',[a.d])).rows[0].tecnico_id;
 eq((await validate(a)).status,'PENDENTE','aprovação tardia já retorna por leitura ruim posterior, sem esperar sete dias');
 eq((await db.query('select tecnico_id from demandas where id=$1',[a.d])).rows[0].tecnico_id,owner,'retorno mantém o mesmo técnico');
 eq((await db.query('select endereco_ofensor from tratativas where id=$1',[a.tr])).rows[0].endereco_ofensor,'1. Original | 2. Adicional','endereços múltiplos permanecem íntegros');
 eq((await db.query('select data_informada from qoe_contexto_atuacao where tratativa_id=$1',[a.tr])).rows[0].data_informada,true,'referência automática dispensa confirmação manual');
 let b=await action('GOOD-1','2026-10-20T12:00:00-03:00');await notes('GOOD-1',Object.fromEntries([21,22,23,24,25,26,27].map(d=>[d,85])));
 eq((await validate(b)).status,'ESTABILIZADA','sete dias reais consecutivos após atuação estabilizam mesmo com aprovação atrasada');
 let c=await action('GAP-1','2026-10-20T12:00:00-03:00');await notes('GAP-1',Object.fromEntries([21,22,24,25,26,27,28].map(d=>[d,85])));
 eq((await validate(c)).status,'MONITORAMENTO','sete leituras com lacuna não são sete dias consecutivos');
 let d=await action('DAY-1','2026-10-25T12:00:00-03:00');await notes('DAY-1',{'25':50,'26':90});
 eq((await validate(d)).status,'MONITORAMENTO','leitura ruim do próprio dia da atuação não reprova trabalho posterior');
 let e=await action('EMPTY-1','2026-10-30T12:00:00-03:00');eq((await validate(e)).status,'MONITORAMENTO','sem leitura nova não presume melhora nem falha');
 let f=await action('CROSS-1','2026-10-25T12:00:00-03:00');await notes('CROSS-1',Object.fromEntries([26,27,28,29,30,31].map(d=>[d,85])));await notes('CROSS-1',{'1':90},'2026-11');
 eq((await validate(f)).status,'ESTABILIZADA','contagem atravessa outubro e novembro sem perder histórico');
 let g=await action('FIRSTBAD-1','2026-10-20T12:00:00-03:00');await notes('FIRSTBAD-1',{'21':70,'22':90,'23':90,'24':90,'25':90,'26':90,'27':90,'28':90});
 eq((await validate(g)).status,'PENDENTE','leitura ruim não é apagada por sete leituras boas posteriores');
 const eventsBefore=(await db.query("select count(*)::int n from historico where demanda_id=$1 and evento='MONITORAMENTO_RETORNO_TRATAMENTO'",[g.d])).rows[0].n;
 await db.query('select gestao_processar_monitoramento_k17($1)',[g.d]);
 eq((await db.query("select count(*)::int n from historico where demanda_id=$1 and evento='MONITORAMENTO_RETORNO_TRATAMENTO'",[g.d])).rows[0].n,eventsBefore,'reprocessamento não duplica retorno');
 await assert.rejects(db.query("select portal_tecnico_contexto_k17('00000000-0000-0000-0000-000000000000')"),/Token inválido/);count++;
 await assert.rejects(notes('BAD-DATE',{'31':85},'2026-11'),/Dia inexistente/);count++;
 // Recuperou sem atuação: registra observação e não volta ao dono se cair depois.
 const obsP=await demand('OBS-1');const obsD=(await db.query("insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) select $1,id,'PENDENTE',1,'2026-10-10' from tecnicos where nome='Beto' returning id",[obsP])).rows[0].id;
 await notes('OBS-1',{'31':90});await db.query('select gestao_snapshot_k17()');await notes('OBS-1',{'1':65},'2026-11');
 const snap=(await db.query('select gestao_snapshot_k17() s')).rows[0].s;
 eq(snap.demandas.find(x=>x.demanda_id===obsD).observacao_pre_atuacao,true,'queda após recuperação não redistribui demanda antiga automaticamente');
 const betoToken=(await db.query("select token_acesso from tecnicos where nome='Beto'")).rows[0].token_acesso;
 eq((await db.query('select portal_tecnico_carteira_k17($1) x',[betoToken])).rows[0].x.some(x=>x.demanda_id===obsD),false,'Portal também oculta observação da carteira executável');
 // Importação novembro não apaga outubro nem cria demandas.
 const numDem=(await db.query('select count(*)::int n from demandas')).rows[0].n;await notes('CROSS-1',{'1':90},'2026-11');
 eq((await db.query('select count(*)::int n from demandas')).rows[0].n,numDem,'atualizar Excel não cria alocação');
 eq((await db.query("select count(*)::int n from qoe_leituras_hfc where porta='CROSS-1'")).rows[0].n,7,'reimportação idempotente conserva sete datas entre meses');
 // Precisa da base de outubro para fechar semana 1; reaproveita leituras já guardadas.
 await notes('B-1',{'18':70},'2026-10');await notes('B-1',{'1':70},'2026-11');
 const savedPayload=(await db.query('select dados from qoe_base_diaria where id=1')).rows[0].dados;
 await db.query("select gestao_semanal_iniciar_k17(1,'2026-10-19')");
 eq((await db.query('select dados from qoe_base_diaria where id=1')).rows[0].dados,savedPayload,'fechamento retroativo preserva a base diária atual de novembro');
 const wk=(await db.query('select gestao_semanal_ler_k17() x')).rows[0].x;
 eq(wk.semana_atual,2,'semana avança apenas por comando explícito');
 eq((await db.query('select pendente from qoe_semana_portas where semana=2 and demanda_id=$1',[obsD])).rows[0].pendente,false,'observação sai das pendências sem apagar recebimento da semana');
 for(let n=1;n<=5;n++){await db.query("insert into portas_qoe(porta,nota_atual) values($1,70)",['NEW-'+n]);await db.query("select gestao_semanal_alocar($1,'Beto',2)",['NEW-'+n]);}
 await db.query('select gestao_semanal_ler_k17()');let report=(await db.query('select gestao_relatorio_tecnicos_k17(2) x')).rows[0].x;
 const beto=report.tecnicos.find(x=>x.tecnico==='Beto'),ana=report.tecnicos.find(x=>x.tecnico==='Ana');
 eq(beto.pendentes,10,'cinco pendentes e cinco novas resultam em dez na carga');
 eq(beto.recebidas,11,'normalização preserva recebimento histórico sem permanecer na carga');eq(beto.sem_atuacao,true,'técnico com pendência e nenhuma atuação é destacado');
 eq(ana.sem_atuacao,false,'aprovação atrasada não apaga execução pela data real');
 eq(ana.assertividade,50,'assertividade usa duas estabilizadas entre quatro resultados concluídos');
 eq(ana.acompanhamento,3,'acompanhamentos não entram no denominador da assertividade');
 eq(ana.atuadas,7,'cada porta física atuada conta uma vez na semana');
 // Legado sem data real: validação exige conferência, sem inventar o horário.
 const lp=await demand('LEGACYDATE-1');const ld=(await db.query("insert into demandas(porta_id,tecnico_id,status,semana,distribuida_em) select $1,id,'ATUACAO_REGISTRADA',2,'2026-10-01' from tecnicos where nome='Ana' returning id",[lp])).rows[0].id;
 const lt=(await db.query("insert into tratativas(demanda_id,tipo_atuacao) values($1,'MDU') returning id",[ld])).rows[0].id;
 await db.query("update tratativas set criado_em='2026-10-29T10:00:00-03:00' where id=$1",[lt]);
 eq((await db.query('select gestao_validar_atuacao_k17($1,$2) x',[ld,lt])).rows[0].x.status,'MONITORAMENTO','legado aprova sem data manual');
 eq((await db.query('select origem_data from qoe_contexto_atuacao where tratativa_id=$1',[lt])).rows[0].origem_data,'REGISTRO_PORTAL','origem automática fica identificada');
 eq((await db.query('select atuada_em=(select criado_em from tratativas where id=$1) same from qoe_contexto_atuacao where tratativa_id=$1',[lt])).rows[0].same,true,'aprovação tardia não reinicia data de registro');
 await db.query("select gestao_importar_legado_k17($1)",[{mes:'2026-09',oct:{'LEGACYBASE-1':['LEGACYBASE',{'30':85}]}}]);
 await notes('LEGACYBASE-1',{'30':90},'2026-09');
 await db.query("select gestao_importar_legado_k17($1)",[{mes:'2026-09',oct:{'LEGACYBASE-1':['LEGACYBASE',{'30':85}]}}]);
 eq(Number((await db.query("select nota from qoe_leituras_hfc where porta='LEGACYBASE-1'")).rows[0].nota),90,'base fechada de setembro preenche lacunas sem sobrescrever correção existente');
 const lm=await action('LEGACYMON-1','2026-10-29T10:00:00-03:00');await notes('LEGACYMON-1',{'30':70});
 await db.query("update demandas set status='MONITORAMENTO' where id=$1",[lm.d]);
 await db.query("update qoe_contexto_atuacao set data_informada=false,origem_data='REGISTRO_LEGADO',validada_em=now(),decisao='VALIDADA' where tratativa_id=$1",[lm.tr]);
 eq((await db.query('select gestao_processar_monitoramento_k17($1) x',[lm.d])).rows[0].x.status,'PENDENTE','legado antes bloqueado retorna automaticamente pela leitura ruim');
 const stable=await action('OLDSTABLE-1','2026-10-20T10:00:00-03:00');await notes('OLDSTABLE-1',Object.fromEntries([21,22,23,24,25,26,27].map(d=>[d,85])));
 await db.query("update demandas set status='MONITORAMENTO' where id=$1",[stable.d]);
 await db.query("update qoe_contexto_atuacao set data_informada=false,atuada_em='2026-11-01',validada_em=now(),decisao='VALIDADA' where tratativa_id=$1",[stable.tr]);
 await db.query('select gestao_snapshot_k17()');
 eq((await db.query('select status from demandas where id=$1',[stable.d])).rows[0].status,'ESTABILIZADA','snapshot destrava legado usando registro original e sete dias consecutivos');
 const original=(await db.query('select criado_em from tratativas where id=$1',[stable.tr])).rows[0].criado_em;
 await db.query("select gestao_confirmar_data_atuacao_k17($1,'2099-01-01')",[stable.tr]);
 eq((await db.query('select atuada_em from qoe_contexto_atuacao where tratativa_id=$1',[stable.tr])).rows[0].atuada_em,original,'compatibilidade com interface antiga não altera a data nem reabre conclusão');
 await db.exec(fs.readFileSync(path.join(root,'01_SUPABASE_K17_2.sql'),'utf8'));
 eq((await db.query('select status from demandas where id=$1',[stable.d])).rows[0].status,'ESTABILIZADA','reaplicar SQL não reabre resultado concluído');
 const realPath=path.join(__dirname,'expected-real.json');
 if(fs.existsSync(realPath)){
  const real=JSON.parse(fs.readFileSync(realPath,'utf8'));const expectedN=Object.values(real).reduce((n,v)=>n+Object.keys(v[1]).length,0);
  const started=Date.now();await db.query('select gestao_salvar_base_diaria_k17($1)',[{mes:'2026-10',oct:real}]);
  const actual=(await db.query("select count(*)::int n from qoe_leituras_hfc where porta=any($1::text[]) and data_leitura between '2026-10-01' and '2026-10-12'",[Object.keys(real)])).rows[0].n;
  eq(actual,expectedN,'importação SQL em lote confere as 48.288 leituras reais');console.log('Importação real em lote:',Date.now()-started,'ms');
 }
 await db.close();console.log(count+' verificações SQL K17.2 passaram.');
}
main().catch(e=>{console.error(e);process.exit(1);});
