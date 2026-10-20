const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../gestao.html'),'utf8');
const source=html.slice(html.indexOf('// K16.4 candidata'),html.indexOf('function renderAutoMonitor(){'));
function setup(initial={}){
 const saved=new Map();let fail=false;
 const selector={value:'',innerHTML:''},body={innerHTML:''};
 const ctx={console,Date,Set,Number,JSON,String,Object,Array,Math,
   INITIAL_ASSIGN:{'AAA-1':'Ana','AAA-2':'Ana','BBB-1':'Beto'},STATEKEY:'test',
   state:{assign:{'AAA-1':'Ana','AAA-2':'Ana','BBB-1':'Beto'},history:[],portReceived:{},distributed:{},...initial},
   localStorage:{setItem(k,v){if(fail)throw Error('storage failure');saved.set(k,v);}},
   document:{getElementById(id){return id==='weekSel'?selector:null;}},
   weekSel:selector,weeklyBody:body,verifyBaseline(){},renderTechCards(){},persist(){ctx.localStorage.setItem('test',JSON.stringify(ctx.state));}
 };
 ctx.window=ctx;ctx.allPorts=[{porta:'AAA-1',cur:70},{porta:'AAA-2',cur:85},{porta:'BBB-1',cur:75}];
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,saved,selector,body,failStorage(){fail=true;}};
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('recupera semana real do ledger e preserva contador anterior no backup',()=>{
 const {ctx,saved}=setup({currentWeek:5,weeklyLedger:{week:1,received:{Ana:['AAA-1']},treated:{}}});
 const before=plain(ctx.state);
 const wl=ctx.qoeWeeklyCurrent();
 assert.equal(wl.week,1);assert.equal(ctx.state.currentWeek,1);
 assert.deepEqual(JSON.parse(saved.get('test_antes_k164')),before);
 assert.equal(ctx.qoeWeeklyTotals(wl).sent,3);
 assert.equal(ctx.qoeWeeklyTotals(wl).normalized,1);
 assert.equal(ctx.qoeWeeklyTotals(wl).done,0);
});
test('uma única migração não substitui histórico nem carteira nem cria demandas',()=>{
 const {ctx,saved}=setup({history:[{porta:'X-1',tech:'Ana',active:true,week:1}],assign:{'AAA-1':'Ana'}});
 const original=plain(ctx.state);ctx.qoeWeeklyCurrent();const backup=saved.get('test_antes_k164');
 ctx.qoeWeeklyCurrent();
 assert.equal(saved.get('test_antes_k164'),backup);
 assert.deepEqual(plain(ctx.state.history),original.history);
 assert.deepEqual(plain(ctx.state.assign),original.assign);
});
test('Marco 0 completo não é reconstruído pela carteira atual nem limitado após novas portas',()=>{
 const {ctx}=setup({assign:{}});
 ctx.INITIAL_ASSIGN=Object.fromEntries(Array.from({length:65},(_,i)=>['P-'+i,'T'+Math.floor(i/5)]));
 const wl=ctx.qoeWeeklyCurrent();assert.equal(ctx.qoeWeeklyTotals(wl).sent,65);
 for(let i=0;i<3;i++)ctx.qoeWeeklyReceive('N-'+i,'T0');
 assert.equal(wl.received.T0.length,8);assert.equal(ctx.qoeWeeklyTotals(wl).sent,68);
});
test('normaliza somente antes de atuação, incluindo nota 80; leitura ausente não normaliza',()=>{
 const {ctx}=setup();const wl=ctx.qoeWeeklyCurrent();
 ctx.allPorts[0].cur=80;ctx.allPorts[1].cur=null;
 let m=ctx.qoeWeeklyMetrics(wl,'Ana');assert.deepEqual(plain(m.normalized),['AAA-1']);
 ctx.qoeCloudDemandByPortV711K10={'AAA-1':{status:'ATUACAO_REGISTRADA'}};
 m=ctx.qoeWeeklyMetrics(wl,'Ana');assert.equal(m.normalized.length,0);assert.equal(m.pending.length,2);
 ctx.qoeCloudDemandByPortV711K10={};ctx.state.history.push({porta:'AAA-1',active:true,week:0});
 assert.equal(ctx.qoeWeeklyMetrics(wl,'Ana').normalized.length,0);
});
test('validação conta tratamento uma vez e não normalização nem estabilização automática',()=>{
 const {ctx}=setup();const wl=ctx.qoeWeeklyCurrent();wl.treated.Ana=['AAA-1','AAA-1'];
 ctx.allPorts[0].cur=90;
 const m=ctx.qoeWeeklyMetrics(wl,'Ana');assert.equal(m.treated.length,1);
 assert.equal(m.normalized.length,1);assert.equal(m.pending.length,0);
 assert.equal(ctx.state.assign['AAA-1'],'Ana');
});
test('fecha semana 1, preserva resultados e carrega pendentes sem alterar carteira/status',()=>{
 const {ctx}=setup();ctx.qoeWeeklyCurrent();
 ctx.qoeCloudDemandByPortV711K10={'BBB-1':{porta:'BBB-1',tecnico:'Beto',status:'ATUACAO_REGISTRADA'}};
 const assignments=plain(ctx.state.assign),cloud=plain(ctx.qoeCloudDemandByPortV711K10);
 const next=ctx.qoeWeeklyAdvance('19/10/2026');
 assert.equal(next.week,2);assert.equal(next.start,'19/10/2026');
 assert.deepEqual(plain(next.received),{Ana:['AAA-1'],Beto:['BBB-1']});
 assert.equal(ctx.qoeWeeklyTotals(next).newPorts,0);
 assert.deepEqual(plain(ctx.state.assign),assignments);assert.deepEqual(plain(ctx.qoeCloudDemandByPortV711K10),cloud);
 ctx.allPorts.forEach(x=>x.cur=99);
 const old=ctx.qoeWeeklyTotals(ctx.state.weeklyArchive[1]);
 assert.equal(old.pending,2);assert.equal(old.normalized,1);assert.equal(old.sent,3);
});
test('cinco pendências + duas novas = sete, sem avançar semana na distribuição',()=>{
 const {ctx}=setup({assign:Object.fromEntries(Array.from({length:5},(_,i)=>['P-'+i,'Ana']))});
 ctx.INITIAL_ASSIGN={...ctx.state.assign};ctx.qoeWeeklyCurrent();ctx.qoeWeeklyAdvance('19/10/2026');
 ctx.qoeWeeklyReceive('N-1','Ana');ctx.qoeWeeklyReceive('N-2','Ana');ctx.qoeWeeklyReceive('N-2','Ana');
 const m=ctx.qoeWeeklyMetrics(ctx.state.weeklyLedger,'Ana');
 assert.equal(m.received.length,7);assert.equal(m.newPorts.length,2);assert.equal(ctx.state.currentWeek,2);
});
test('recorrente após atuação não sai da pendência por nota atual boa',()=>{
 const {ctx}=setup();ctx.qoeWeeklyCurrent();ctx.allPorts[0].cur=90;
 ctx.qoeCloudDemandByPortV711K10={'AAA-1':{porta:'AAA-1',tecnico:'Ana',status:'RECORRENTE'}};
 const next=ctx.qoeWeeklyAdvance('19/10/2026');assert.deepEqual(plain(next.received.Ana),['AAA-1']);
});
test('retirada manual e monitoramento não são realocados na virada',()=>{
 const {ctx}=setup();ctx.qoeWeeklyCurrent();delete ctx.state.assign['AAA-1'];
 ctx.qoeCloudDemandByPortV711K10={'BBB-1':{porta:'BBB-1',tecnico:'Beto',status:'MONITORAMENTO'}};
 const next=ctx.qoeWeeklyAdvance('19/10/2026');assert.equal(ctx.qoeWeeklyTotals(next).sent,0);
});
test('falha de gravação não avança semana nem arquiva parcialmente',()=>{
 const {ctx,failStorage}=setup();ctx.qoeWeeklyCurrent();const before=plain(ctx.state);failStorage();
 assert.throws(()=>ctx.qoeWeeklyAdvance('19/10/2026'),/storage failure/);
 assert.deepEqual(plain(ctx.state),before);
});
test('seletor, tabela e resumo usam mesma semana, incluindo zero e nome escapado',()=>{
 const {ctx,selector,body}=setup();ctx.qoeWeeklyCurrent();ctx.qoeWeeklyAdvance('19/10/2026');
 selector.value='1';ctx.renderWeeks();assert.match(body.innerHTML,/Semana 1/);
 assert.equal(ctx.qoeWeeklyTotals(ctx.qoeWeeklySelected()).sent,3);
 selector.value='2';ctx.renderWeeks();assert.match(body.innerHTML,/Semana 2/);
 assert.equal(ctx.qoeWeeklyTotals(ctx.qoeWeeklySelected()).sent,2);
 ctx.qoeWeeklyReceive('X','<img>');ctx.renderWeeks();assert.match(body.innerHTML,/&lt;img&gt;/);
});
test('todos os scripts executáveis compilam; resumo e WhatsApp usam fonte operacional',()=>{
 let count=0;
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc=|type="text\/plain"/.test(m[1]))continue;
   new vm.Script(m[2]);count++;
 }
 assert.ok(count>=10);
 const report=html.match(/<script id="v796-weekly-report">([\s\S]*?)<\/script>/)[1];
 assert.match(report,/qoeWeeklyTotals\(qoeWeeklySelected\(\)\)/);
 assert.doesNotMatch(report,/window\.state/);
 assert.match(html,/qoeWeeklyMetrics\(qoeWeeklyCurrent\(\),t\)/);
});
