const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'..');
function app(file,rpc){
 if(global.gc)global.gc();
 const errors=[],calls=[],alerts=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(path.join(root,file),'utf8'),{runScripts:'outside-only',url:'https://qoe.test/'+file+'?t=11111111-1111-1111-1111-111111111111',virtualConsole:vc});const w=dom.window;
 w.setTimeout=()=>0;w.setInterval=()=>0;w.scrollTo=()=>{};w.alert=x=>alerts.push(x);w.confirm=()=>true;w.prompt=()=>null;
 for(const key of ['DecompressionStream','Response','Blob','TextDecoder','TextEncoder'])w[key]=globalThis[key];
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent},set(x){this.textContent=x}});
 w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){},signOut:async()=>{}},rpc:async(name,args)=>{calls.push({name,args});return rpc?rpc(name,args):{data:[],error:null};}})};
 for(const s of w.document.querySelectorAll('script')){if(s.src||s.type==='text/plain')continue;new vm.Script(s.textContent).runInContext(dom.getInternalVMContext());}
 return {dom,w,errors,calls,alerts,run:x=>vm.runInContext(x,dom.getInternalVMContext()),close:()=>w.close()};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('Gestão inicializa com todos os scripts, sem rede ou alteração de carteira no banco',async()=>{
 const a=app('gestao.html');await settle();assert.deepEqual(a.errors,[]);assert.equal(a.calls.length,0);
 assert.equal(a.w.document.querySelector('#reportMonthK17').type,'month');assert.ok(a.w.document.querySelector('#weeklyTechReportK17'));a.close();
});
test('Portal envia três endereços e deixa a data do registro sob controle do banco',async()=>{
 const a=app('portal.html',(name)=>({data:name==='portal_tecnico_carteira_k17'?[{demanda_id:'d1',porta:'P-1',tecnico:'Ana',status:'PENDENTE',nota_atual:70,media_30d:75}]:[],error:null}));await settle();
 a.w.openM('d1','P-1');assert.equal(a.w.document.querySelector('#actionAtK17'),null);a.w.type.value='MDU';a.w.ret.value='Atuação realizada';
 a.w.addrList.querySelector('input').value='Endereço original';a.w.addAddress('Segundo endereço');a.w.addAddress('Terceiro endereço');await a.w.save();
 const c=a.calls.find(x=>x.name==='portal_tecnico_registrar_atuacao_k17');assert.equal(c.args.p_atuada_em,null);
 assert.equal(c.args.p_endereco,'1. Endereço original | 2. Segundo endereço | 3. Terceiro endereço');assert.match(a.alerts.at(-1),/3 endereços/);assert.deepEqual(a.errors,[]);a.close();
});
test('Portal bloqueia endereço MDU ausente e não oferece data editável',async()=>{
 const a=app('portal.html');await settle();a.w.openM('d1','P-1');a.w.ret.value='Atuado';a.w.type.value='MDU';await a.w.save();
 assert.match(a.alerts.at(-1),/endereço/);assert.equal(a.w.document.getElementById('actionAtK17'),null);
 assert.equal(a.calls.some(x=>x.name==='portal_tecnico_registrar_atuacao_k17'),false);a.close();
});
test('Portal não duplica envio por dois cliques',async()=>{
 let resolveSend;const a=app('portal.html',(name)=>name==='portal_tecnico_registrar_atuacao_k17'?new Promise(r=>resolveSend=r):{data:[],error:null});await settle();
 a.w.openM('d1','P-1');a.w.ret.value='Atuado';const pending=a.w.save();await a.w.save();
 assert.equal(a.calls.filter(x=>x.name==='portal_tecnico_registrar_atuacao_k17').length,1);resolveSend({data:'tr1',error:null});await pending;a.close();
});
test('validação tardia apresenta retorno real, em vez de afirmar que ficou em acompanhamento',async()=>{
 const a=app('gestao.html');await settle();a.w.qoePendingReturnsV711K=[{tr:{id:'tr1',data_informada:true,criado_em:'2026-11-01T12:00:00Z',atuada_em:'2026-10-29T12:00:00Z'},d:{demanda_id:'d1',porta:'P-1',tecnico:'Ana'}}];
 a.w.qoeRpc=async()=>({data:{status:'PENDENTE'},error:null});a.w.qoeRemoteRefresh=async()=>{};await a.w.qoeValidateCloudReturnV711K('tr1');
 assert.match(a.alerts.at(-1),/retornou ao técnico/);assert.equal(a.run('state.history.at(-1).actionAt'),'2026-11-01T12:00:00Z');a.close();
});
test('tratativa antiga aprova sem confirmação manual da data',async()=>{
 const a=app('gestao.html');await settle();a.w.qoePendingReturnsV711K=[{tr:{id:'old1',criado_em:'2026-11-01T12:00:00Z',data_informada:false},d:{demanda_id:'d1',porta:'P-1',tecnico:'Ana'}}];
 a.w.renderPendingReturnsV711K();let posted;
 a.w.qoeRpc=async(name,args)=>{posted={name,args};return {data:{status:'MONITORAMENTO'},error:null}};a.w.qoeRemoteRefresh=async()=>{};
 assert.equal(a.w.document.getElementById('legacyActionK17-old1'),null);
 await a.w.qoeValidateCloudReturnV711K('old1');assert.equal(posted.name,'gestao_validar_atuacao_k17');
 assert.equal(posted.args.p_atuada_em,'2026-11-01T12:00:00Z');assert.match(a.alerts.at(-1),/data do registro/);a.close();
});
test('registro pela Gestão abre o formulário com data real e não usa referências inexistentes',async()=>{
 const a=app('gestao.html');await settle();a.w.openTreatV7('SPEAH-4');
 assert.equal(a.w.document.getElementById('actionAtK17'),null);assert.ok(a.w.treatModalV7.classList.contains('open'));a.w.closeTreatV7();a.close();
});
test('acompanhamento legado exibe data do registro sem campo ou botão de confirmação',async()=>{
 const a=app('gestao.html');await settle();
 a.w.qoeCloudDemandStatusByPortV711K8={'P-1':'MONITORAMENTO'};
 a.w.qoeCloudDemandByPortV711K10={'P-1':{porta:'P-1',demanda_id:'d1',status:'MONITORAMENTO',tecnico:'Ana'}};
 a.w.qoeCloudTratativasV711K10=[{id:'oldmon',demanda_id:'d1',criado_em:'2026-11-01T12:00:00Z',data_informada:false,leituras_pos:[],sequencia:0}];
 a.w.renderTreatmentFlowV710();assert.match(a.w.document.body.textContent,/Data do registro no Portal/);assert.equal(a.w.document.getElementById('monitorActualK17-oldmon'),null);
 assert.doesNotMatch(a.w.document.body.textContent,/Confirmar data real|Data real a conferir/);a.close();
});
test('relatório destaca técnico sem atuação e separa aguardando Gestão de resultado',async()=>{
 const a=app('gestao.html');await settle();a.run(`qoeMonthlyK18={versao:180,mes_atual:'2026-11',meses:[{mes:'2026-11',tecnicos:[]}],semanas_legadas:[]}`);
 a.w.weekSel.innerHTML='<option value="2026-11">Novembro</option>';
 const rows=[{tecnico:'Ana',recebidas:10,herdadas:5,novas:5,atuadas:0,devolutivas:0,validadas:0,aguardando_validacao:0,estabilizadas:0,retornos:0,acompanhamento:0,pendentes:10,sem_atuacao:true,assertividade:null,portas_pendentes:['A-1','A-2']},
 {tecnico:'Beto',recebidas:5,herdadas:2,novas:3,atuadas:3,devolutivas:3,validadas:1,aguardando_validacao:2,estabilizadas:0,retornos:0,acompanhamento:1,pendentes:2,sem_atuacao:false,assertividade:null,portas_pendentes:['B-1']}];
 a.run('qoeMonthlyK18.meses[0].tecnicos='+JSON.stringify(rows));await a.w.qoeReportLoadK17();
 assert.match(a.w.techReportBodyK17.rows[0].textContent,/SEM ATUAÇÃO NO MÊS/);assert.match(a.w.techReportBodyK17.rows[1].textContent,/aguardando a Gestão/);
 let copied;Object.defineProperty(a.w.navigator,'clipboard',{value:{writeText:async x=>{copied=x}}});await a.w.qoeCopyChargeK17(0);
 assert.match(copied,/Herdadas: 5/);assert.match(copied,/A-1, A-2/);assert.match(copied,/data\/hora do registro/);a.close();
});
test('algoritmo de oscilação, Marco 0 e retirada manual continuam presentes',()=>{
 const before=fs.readFileSync(path.join(root,'baseline/gestao.html'),'utf8'),after=fs.readFileSync(path.join(root,'gestao.html'),'utf8');
 const part=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
 for(const [a,b] of [['function recentReadingsV79(','function renderOscillatingV79(){'],['async function qoeMigrateInitial65(){','const _qoeConfirmAlloc=confirmAlloc;'],['const _qoeRemoveAlloc=removeAlloc;','const _qoeConfirmTreat=confirmTreatV7;']])assert.equal(part(after,a,b),part(before,a,b));
 assert.ok(after.includes("raw!==''?Number(raw):NaN"));assert.ok(!after.includes('if(y!==2026||m!==10)continue;'));
});
const realExcel=process.env.QOE_REAL_EXCEL||path.join(root,'../qoe_sources/data (8)(1).xlsx');
test('Excel real é processado integralmente pelo leitor do navegador, sem inventar leituras vazias',{skip:!fs.existsSync(realExcel)},async()=>{
 const a=app('gestao.html');await settle();
 const file=fs.readFileSync(realExcel);
 const data=await a.w.parseUploaded({arrayBuffer:async()=>file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength)});
 const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'real-expected-summary.json'),'utf8'));
 assert.equal(Object.keys(data).length,expected.portas,'quantidade de portas do Excel real');
 const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
 assert.equal(require('crypto').createHash('sha256').update(stable(data)).digest('hex'),expected.sha256,'todas as portas e notas correspondem à leitura XML independente');
 // O parser real já foi exercitado acima. No teste da transação de importação,
 // reutiliza seu resultado para não materializar duas árvores XML simultâneas.
 a.w.parseUploaded=async()=>data;a.w.rebuild=()=>{};
 a.w.dailyFile._fileData=file;
 Object.defineProperty(a.w.dailyFile,'files',{value:[{arrayBuffer:async()=>file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength)}]});
 a.w.reportMonthK17.value='2026-10';await a.w.updateDaily();
 assert.match(a.w.updateMsg.textContent,/Atualizado até dia/);assert.equal(a.calls.some(x=>x.name.includes('alocar')),false);a.close();
});

function monthlyPayload(){return {versao:180,mes_atual:'2026-11',atualizado_em:'2026-11-10T15:00:00Z',meses:[{mes:'2026-11',inicio:'2026-11-01',fim:'2026-11-30',tecnicos:[{tecnico:'Ana',recebidas:7,herdadas:5,novas:2,tratadas:1,atuadas:2,devolutivas:2,normalizadas:1,pendentes:4,retiradas:0,validadas:1,estabilizadas:0,retornos:0,acompanhamento:1,aguardando_validacao:1,portas_pendentes:['A-1'],assertividade:null}],totais:{recebidas:7,atuadas:2,validadas:1,normalizadas:1,pendentes:4,novas:2,retiradas:0,tecnicos_atuantes:1,total_tecnicos:1,acompanhamento:1,estabilizadas:0,retornos:0},distribuidas:{Ana:{date:'10/11/2026'}},conflitos:[]}],semanas_legadas:[{semana:1,inicio:'2026-10-09',tecnicos:[{tecnico:'Ana',recebidas:5,tratadas:2,normalizadas:1,pendentes:2,novas:5,retiradas:0,sem_leitura:0}]}]};}
test('mensal é o período padrão e histórico semanal permanece consultável sem escrita',async()=>{
 const a=app('gestao.html');await settle();const oldWeek=a.run('state.currentWeek');a.w.qoeMonthlyApplyK18(monthlyPayload());
 assert.equal(a.w.weekSel.value,'2026-11');assert.match(a.w.weeklyBody.textContent,/Mês 11\/2026/);
 assert.equal(a.run('state.currentWeek'),oldWeek);assert.match(a.w.wkReading.textContent,/2 portas atuadas de 7 recebidas/);
 assert.equal(a.w.wkDone.textContent,'2');assert.ok(a.w.weekSel.querySelector('option[value="S:1"]'));
 a.w.weekSel.value='S:1';a.w.renderWeeks();assert.match(a.w.weeklyBody.textContent,/Semana 1/);assert.match(a.w.techReportBodyK17.textContent,/preservado/);
 assert.equal(a.calls.length,0);a.close();
});
test('distribuir aloca manualmente no mês aberto sem avançar período ou chamar RPC semanal',async()=>{
 const a=app('gestao.html');await settle();const data=monthlyPayload();a.w.qoeCheckSession=async()=>true;
 const posted=[];a.w.qoeRpc=async(name,args)=>{posted.push({name,args});return {data:name==='gestao_mensal_ler_k18'?data:'d-new',error:null}};
 a.w.qoeRemoteRefresh=async()=>{};a.run("target='SPEAH-4'");a.w.techSel.value=a.w.techSel.options[0]?.value||'';
 // A carteira exige uma escolha explícita válida do gestor.
 a.w.techSel.innerHTML='<option>Ana</option>';a.w.techSel.value='Ana';await a.w.confirmAlloc();
 const c=posted.find(x=>x.name==='gestao_mensal_alocar_k18');assert.ok(c);assert.equal(c.args.p_mes_esperado,'2026-11-01');
 assert.equal(posted.some(x=>/semanal_|iniciar/.test(x.name)),false);a.close();
});
test('abrir próximo mês trata erro sem avançar localmente e não chama abertura semanal',async()=>{
 const a=app('gestao.html');await settle();const data=monthlyPayload();a.w.qoeCheckSession=async()=>true;const posted=[];
 a.w.qoeRpc=async(name,args)=>{posted.push({name,args});return name==='gestao_mensal_ler_k18'?{data,error:null}:{data:null,error:{message:'O próximo mês ainda não começou.'}}};
 await a.w.qoeStartNextMonthK18();assert.equal(a.run('qoeMonthlyK18.mes_atual'),'2026-11');assert.match(a.alerts.at(-1),/ainda não começou/);
 assert.equal(posted.some(x=>x.name==='gestao_semanal_iniciar_k17'),false);a.close();
});
test('resumo mensal e cobrança copiam período correto sem enviar mensagens',async()=>{
 const a=app('gestao.html');await settle();const data=monthlyPayload();a.w.qoeCheckSession=async()=>true;a.w.qoeRpc=async()=>({data,error:null});
 a.w.qoeMonthlyApplyK18(data);let copied;Object.defineProperty(a.w.navigator,'clipboard',{value:{writeText:async x=>copied=x}});
 await a.w.copyWeeklyV796();assert.match(copied,/Mês 11\/2026/);assert.match(copied,/Atuadas: 2/);
 await a.w.qoeCopyChargeK17(0);assert.match(copied,/11\/2026/);assert.match(copied,/Herdadas: 5/);a.close();
});

test('navegação Mensal reúne distribuição, resultado por técnico e resumo',async()=>{
 const a=app('gestao.html');await settle();a.w.qoeMonthlyApplyK18(monthlyPayload());a.w.qoePage('semanal');
 for(const id of ['weeklyTechReportK17','weeklyReportV796'])assert.equal(a.w.document.getElementById(id).classList.contains('qoe-page-hidden'),false);
 assert.match(a.w.qoePageTitle.textContent,/Mensal/);a.close();
});
