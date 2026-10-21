const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');const html=fs.readFileSync(path.join(root,'gestao.html'),'utf8');
const block=html.slice(html.indexOf('// K16.5 — fonte'),html.indexOf('function resetWeeklyCount(){'));
function fixture(){
 const els={weekSel:{value:''},weeklyBody:{innerHTML:''},weeklySyncK165:{textContent:''}};
 const saved=new Map(),calls=[],alerts=[];let actor=true,error=null;
 const row={tecnico:'Ana',recebidas:7,tratadas:2,normalizadas:1,pendentes:4,novas:2,retiradas:0,sem_leitura:0};
 const data={versao:165,semana_atual:2,atualizado_em:'2026-10-20T12:00:00Z',semanas:[{semana:1,inicio:'2026-10-09',fim:'2026-10-18',fechada_em:'x',tecnicos:[{...row,recebidas:5,novas:5}],distribuidas:{}},{semana:2,inicio:'2026-10-19',fim:null,tecnicos:[row],distribuidas:{}}]};
 const ctx={state:{assign:{'A-1':'Ana'},history:[{porta:'Z',active:true}],currentWeek:999,distributed:{}},STATEKEY:'qoe',window:null,document:{getElementById:id=>els[id]},console,
 localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},persist(){saved.set('qoe',JSON.stringify(ctx.state));},renderTechCards(){},verifyBaseline(){},
 qoeCheckSession:async()=>actor,qoeRpc:async(name,args)=>{calls.push({name,args});return {data,error};},alert:s=>alerts.push(s),prompt:()=>null,confirm:()=>true};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(block,ctx);
 return {ctx,data,els,calls,alerts,saved,setError(e){error=e;},logout(){actor=false;},read(expr){return vm.runInContext(expr,ctx);}};
}
test('scripts executáveis compilam sem executar login nem operações',()=>{
 let count=0;for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc=|type="text\/plain"/.test(m[1]))continue;new vm.Script(m[2]);count++;
 }assert.ok(count>=10);
});
test('carrega semana do servidor e guarda estado anterior sem resetar dados operacionais',async()=>{
 const f=fixture(),old=JSON.stringify(f.ctx.state);assert.equal(await f.ctx.qoeWeeklyLoadK165(),true);
 assert.equal(f.ctx.state.currentWeek,2);assert.equal(f.saved.get('qoe_antes_k165'),old);
 assert.equal(f.ctx.state.assign['A-1'],'Ana');assert.equal(f.ctx.state.history.length,1);
 assert.match(f.els.weeklyBody.innerHTML,/Semana 2/);assert.equal(f.calls[0].name,'gestao_semanal_ler');
});
test('seletor e total usam mesma semana; não confunde portas herdadas com novas',async()=>{
 const f=fixture();await f.ctx.qoeWeeklyLoadK165();
 assert.equal(f.ctx.qoeWeeklyTotalsK165(f.ctx.qoeWeeklySelectedK165()).sent,7);
 f.els.weekSel.value='1';f.ctx.renderWeeks();assert.match(f.els.weeklyBody.innerHTML,/Semana 1/);
 assert.equal(f.ctx.qoeWeeklyTotalsK165(f.ctx.qoeWeeklySelectedK165()).sent,5);
 f.els.weekSel.value='2';assert.equal(f.ctx.qoeWeeklyTotalsK165(f.ctx.qoeWeeklySelectedK165()).newPorts,2);
});
test('resposta antiga não volta para semana anterior',async()=>{
 const f=fixture();await f.ctx.qoeWeeklyLoadK165();
 f.ctx.qoeWeeklyApplyK165({...f.data,semana_atual:1,atualizado_em:'2026-10-20T11:00:00Z'});
 assert.equal(f.ctx.state.currentWeek,2);
});
test('sem autenticação não abre semana nem inventa totais zerados',async()=>{
 const f=fixture();f.logout();await f.ctx.newWeek();assert.equal(f.calls.length,0);
 assert.equal(f.ctx.qoeWeeklyTotalsK165(null),null);assert.match(f.alerts[0],/Entre na Gestão/);
});
test('RPC indisponível não usa contador/cache como fonte de verdade',async()=>{
 const f=fixture();f.setError(Error('missing RPC'));await f.ctx.newWeek();
 assert.equal(f.ctx.state.currentWeek,999);assert.equal(f.calls.length,1);assert.match(f.alerts[0],/SQL K16.5/);
});
test('abertura exige confirmação e envia a semana esperada sem distribuir',async()=>{
 const f=fixture();f.ctx.prompt=()=> '26/10/2026';f.ctx.confirm=()=>false;
 await f.ctx.newWeek();assert.equal(f.calls.filter(c=>c.name==='gestao_semanal_iniciar').length,0);
 f.ctx.confirm=()=>true;await f.ctx.newWeek();
 const open=f.calls.find(c=>c.name==='gestao_semanal_iniciar');assert.equal(open.args.p_semana_atual,2);assert.equal(open.args.p_inicio,'2026-10-26');
 assert.equal(f.calls.some(c=>c.name.includes('alocar')),false);
});
test('texto do técnico é escapado; histórico e resumo não dependem de window.state',async()=>{
 const f=fixture();f.data.semanas[1].tecnicos[0].tecnico='<img>';await f.ctx.qoeWeeklyLoadK165();
 assert.match(f.els.weeklyBody.innerHTML,/&lt;img&gt;/);
 const report=html.match(/<script id="v796-weekly-report">([\s\S]*?)<\/script>/)[1];
 assert.doesNotMatch(report,/window\.state/);assert.match(report,/qoeWeeklyTotalsK165/);
});
test('Marco 0, monitoramento, recorrência, MDU e portal não são reimplementados',()=>{
 const original=process.env.QOE_BASELINE_FILE?fs.readFileSync(process.env.QOE_BASELINE_FILE,'utf8'):require('node:child_process').execFileSync('git',['show','184d28a9f77bc529df318e5020f0caca3a0b27fa:gestao.html'],{encoding:'utf8',maxBuffer:4*1024*1024});
 for(const [start,end] of [
  ['function renderAutoMonitor(){','function renderTechCards(){'],
  ['function recentReadingsV79(','function qoeFmtCloudDateV711K('],
  ['async function qoeValidateCloudReturnV711K(','async function qoeReturnCloudTreatmentV711K('],
  ['async function qoeProcessMonitoringFromDailyV711K13(){','async function qoeRemoteRefresh(){']
 ]){
   const a=original.indexOf(start),b=original.indexOf(end,a);
   assert.ok(a>=0&&b>a,'trecho de regressão deve existir: '+start);
   const source=original.slice(a,b);assert.ok(html.includes(source),start+' deve permanecer igual à fonte publicada');
 }
 assert.match(html,/p_porta:porta,p_tecnico:tecnico,p_semana:1/);
});
