from pathlib import Path
import json,hashlib
r=Path(__file__).resolve().parent
s=(r/'baseline/k16_2.html').read_text();delta=json.loads((r/'baseline/evolucoes_preservadas.json').read_text())
assert hashlib.sha256(s.encode()).hexdigest()==delta['base_sha256']
lines=s.splitlines(keepends=True)
for change in reversed(delta['ops']):lines[change['from']:change['to']]=change['lines']
s=''.join(lines);assert hashlib.sha256(s.encode()).hexdigest()==delta['output_sha256']
p=(r/'baseline/portal.html').read_text()
# K16.2 permanece intocada. A composição conserva as evoluções publicadas,
# substituindo somente os trechos auditados para a candidata K17.
s=s.replace('V7.11.1K16.5','V7.11.1K17.1').replace('Controle semanal compartilhado — em homologação','Fluxo e execução semanal — em homologação')
s=s.replace('// K16.5 — fonte semanal compartilhada.',(r/'client.js').read_text()+'\n// K16.5 — fonte semanal compartilhada.',1)
s=s.replace("qoeRpc('gestao_snapshot'", "qoeRpc('gestao_snapshot_k17'")
s=s.replace("qoeRpc('gestao_semanal_ler'", "qoeRpc('gestao_semanal_ler_k17'")
s=s.replace("qoeRpc('gestao_semanal_iniciar'", "qoeRpc('gestao_semanal_iniciar_k17'")
s=s.replace("qoeRpc('gestao_validar_atuacao'", "qoeRpc('gestao_validar_atuacao_k17'")
s=s.replace("const {error}=await qoeRpc('gestao_validar_atuacao_k17'", "const {data:outcome,error}=await qoeRpc('gestao_validar_atuacao_k17'",1)
s=s.replace(" if(!confirm('Validar a atuação de '", " let confirmedAction=tr.atuada_em;\n if(!tr.data_informada){try{confirmedAction=qoeActionIsoK17('legacyActionK17-'+id);}catch(e){return alert('Confirme com o técnico a data real da atuação: '+e.message);}}\n if(!confirm('Validar a atuação de '",1)
s=s.replace("qoeRpc('gestao_validar_atuacao_k17',{p_demanda_id:d.demanda_id,p_tratativa_id:tr.id})", "qoeRpc('gestao_validar_atuacao_k17',{p_demanda_id:d.demanda_id,p_tratativa_id:tr.id,p_atuada_em:confirmedAction})",1)
s=s.replace(" const x=portfolio.find(z=>z.porta===d.porta)||{};\n const dt=", " if(confirmedAction){tr.atuada_em=confirmedAction;tr.data_informada=true;}\n const x=portfolio.find(z=>z.porta===d.porta)||{};\n const dt=",1)
s=s.replace("alert('Atuação validada. A porta entrou em acompanhamento QoE; a data da atuação do técnico foi preservada.');", "alert(outcome?.status==='PENDENTE'?'Atuação validada. Já existe leitura pós-atuação abaixo de 80: a porta retornou ao técnico.':outcome?.status==='ESTABILIZADA'?'Atuação validada. As sete leituras diárias consecutivas já confirmam estabilização.':'Atuação validada. Acompanhamento iniciado na data real da atuação.');")
s=s.replace('tr.criado_em?new Date(tr.criado_em):new Date()', '(tr.atuada_em||tr.criado_em)?new Date(tr.atuada_em||tr.criado_em):new Date()')
s=s.replace('DATA.find(z=>z.porta===p)', 'portfolio.find(z=>z.porta===p)')
s=s.replace('closeTreatV7();renderAll();alert(', 'closeTreatV7();rebuild();alert(')
s=s.replace('actionAt:tr.criado_em||null','actionAt:tr.atuada_em||tr.criado_em||null')
s=s.replace('qoeFmtCloudDateV711K(tr.criado_em)', "qoeFmtCloudDateV711K(tr.atuada_em||tr.criado_em)+(tr.data_informada?'':' (data legada de registro)')")
s=s.replace("(tr.data_informada?'':' (data legada de registro)')", "(tr.data_informada?'':' (data legada de registro)')",1)
s=s.replace("(tr.data_informada?'':' (data legada de registro)'))}</td>", "(tr.data_informada?'':' (data legada de registro)'))}${!tr.data_informada?'<label>Data/hora real conferida com o técnico</label><input type=\"datetime-local\" id=\"legacyActionK17-'+tr.id+'\">':''}</td>",1)
s=s.replace('date:tr.criado_em,atuacao_em:tr.criado_em,','date:tr.atuada_em||tr.criado_em,atuacao_em:tr.atuada_em||tr.criado_em,sequencia:tr.sequencia,leituras_pos:tr.leituras_pos,data_informada:tr.data_informada,')
s=s.replace('<td>${fmtDate(x.when)}</td>', '<td>${fmtDate(x.when)}${x.raw?.data_informada===false?`<small>Data real a conferir com o técnico</small><input type="datetime-local" id="monitorActualK17-${x.raw.cloudTratativaId}"><button onclick="qoeConfirmMonitorDateK17(\'${x.raw.cloudTratativaId}\')">Confirmar data real</button>`:\'\'}</td>',1)
s=s.replace('d.porta&&d.tecnico)state.assign', 'd.porta&&d.tecnico&&!d.observacao_pre_atuacao)state.assign')
s=s.replace('   ensureV7();\n   state.assign={};', "   qoePortasResumoK17=data.resumo_portas||null;\n   ensureV7();\n   state.assign={};",1)
a=s.index('async function qoeRemoteRefresh(){');b=s.index('async function qoeMigrateInitial65(){',a)
block=s[a:b].replace(" const {data,error}=await qoeRpc('gestao_snapshot_k17');", """ let {data,error}=await qoeRpc('gestao_snapshot_k17');
 if(!error&&data&&!data.meses?.includes('2026-09')){
   const legacy={mes:'2026-09',oct:Object.fromEntries(Object.entries(SEP).map(([p,v])=>[p,[v[0],Object.fromEntries(v[1].map((n,i)=>[String(i+1),n]))]]))};
   const imported=await qoeRpc('gestao_importar_legado_k17',{p_payload:legacy});
   if(imported.error)return alert('Não foi possível preservar a base fechada de setembro: '+imported.error.message);
   ({data,error}=await qoeRpc('gestao_snapshot_k17'));
 }
""",1)
s=s[:a]+block+s[b:]
# Carteira: não transforma queda de uma demanda em observação em distribuição automática.
s=s.replace("   if(typeof window.renderTreatmentFlowV710", "   if(typeof window.renderTreatmentFlowV710",1)
s=s.replace('   const actedCloud=!!st', '   const actedCloud=!!st')
s=s.replace(" if(typeof window.renderWeeklyV796==='function')window.renderWeeklyV796();\n verifyBaseline();", " if(typeof window.renderWeeklyV796==='function')window.renderWeeklyV796();\n if(typeof qoeReportLoadK17==='function')qoeReportLoadK17();\n verifyBaseline();",1)
# Importação: mês explícito, com datas completas preservadas no banco.
s=s.replace('Atualizar relatório diário de outubro','Atualizar relatório diário')
s=s.replace('Setembro permanece fechado; a nova extração substitui somente a base diária atual.', 'Informe o mês correto da extração. O histórico importado fica preservado.')
s=s.replace('Setembro permanece fechado; a nova extração substitui somente a base diária de outubro.', 'Informe o mês correto da extração. O histórico importado fica preservado.')
pos=s.index('<input',s.index('id="uploadBox"'))
s=s[:pos]+'<label>Mês do relatório <input id="reportMonthK17" type="month" value="2026-10"></label>'+s[pos:]
s=s.replace("Selecione o Excel de outubro.","Selecione o Excel diário e informe o mês.")
s=s.replace("c.querySelector('is t')?.textContent||''", "qoeXmlTagsK17(c,'t').map(x=>x.textContent).join('')")
s=s.replace("c.querySelector('v')?.textContent", "qoeXmlTagsK17(c,'v')[0]?.textContent")
s=s.replace("[...d.querySelectorAll('si')]", "qoeXmlTagsK17(d,'si')")
s=s.replace("[...si.querySelectorAll('t')]", "qoeXmlTagsK17(si,'t')")
s=s.replace("[...row.querySelectorAll('c')]", "qoeXmlTagsK17(row,'c')")
s=s.replace("[...d.querySelectorAll('sheetData row')]", "qoeXmlTagsK17(d,'row')")
s=s.replace('let c=cs[+idx],n=c?Number(cellText(c,shared)):NaN;', "let c=cs[+idx],raw=c?String(cellText(c,shared)).trim():'',n=raw!==''?Number(raw):NaN;")
s=s.replace(" updateMsg.innerText='Lendo arquivo...';", " const selectedMonth=qoeMonthK17();if(!confirm('Importar este Excel como '+selectedMonth+'? Confira o mês antes de continuar.'))return;\n updateMsg.innerText='Lendo arquivo...';",1)
s=s.replace("   OCT=next;", "   qoeMonthK17();qoePortasResumoK17=null;\n   OCT=next;",1)
s=s.replace('async function qoeSaveDailySnapshotV711K15(ultimoDia){','async function qoeSaveDailySnapshotV711K15(ultimoDia,mes=qoeMonthK17()){')
s=s.replace('await qoeSaveDailySnapshotV711K15(Math.max(...days));','await qoeSaveDailySnapshotV711K15(Math.max(...days),selectedMonth);',1)
s=s.replace("const payload={mes:'2026-10',", "const payload={mes,")
s=s.replace("qoeRpc('gestao_salvar_base_diaria'", "qoeRpc('gestao_salvar_base_diaria_k17'")
s=s.replace(" const cloudOct=payload?.oct;", " const cloudOct=payload?.oct;\n if(document.getElementById('reportMonthK17'))document.getElementById('reportMonthK17').value=payload.mes||'';")
a=s.index('async function qoeProcessMonitoringFromDailyV711K13(){');b=s.index('async function qoeRemoteRefresh(){',a)
s=s[:a]+'''async function qoeProcessMonitoringFromDailyV711K13(){
 if(!await qoeCheckSession())return {processed:0};
 // A RPC consulta leituras históricas reais e processa os monitoramentos antes do snapshot.
 const {data,error}=await qoeRpc('gestao_snapshot_k17');if(error)throw error;
 return {processed:Array.isArray(data?.demandas)?data.demandas.length:0};
}

'''+s[b:]
s=s.replace('   for(let i=1;i<recent7.length;i++)', '''   const cloud=qoePortasResumoK17?.[porta];
   if(cloud){m30=Number(cloud.media_30d);cur=Number(cloud.nota_atual);recent7=(cloud.leituras_recentes||[]).map(Number);bad7=recent7.filter(v=>v<80).length;good7=recent7.filter(v=>v>=80).length;avg7=avg(recent7);}
   for(let i=1;i<recent7.length;i++)''',1)
a=s.index('    const ap=qoeLocalActionDatePartsV711K13(action.when);');b=s.index('\n  function evaluate(vals)',a)
s=s[:a]+'''    return Array.isArray(action.raw?.leituras_pos)?action.raw.leituras_pos.map(x=>num(x.nota)).filter(v=>v!==null):[];
  }
'''+s[b:]
s=s.replace('      const ev=evaluate(readingsAfterAction(p,a));', "      const ev=evaluate(readingsAfterAction(p,a));\n      if(Number.isInteger(a.raw?.sequencia))ev.consecutive=a.raw.sequencia;")
# Campo data real também no registro de atuação pela Gestão.
s=s.replace('<label>O que foi feito', '<label>O que foi feito')
needle='<textarea id="returnV7"'
if needle not in s: needle='<textarea id="returnV7"'
idx=s.index(needle)
s=s[:idx]+'<input type="datetime-local" id="actionAtK17" required>'+s[idx:]
s=s.replace('<label>O que foi feito / devolutiva</label><input type="datetime-local" id="actionAtK17" required>', '<label>Data/hora da atuação (Brasília)</label><input type="datetime-local" id="actionAtK17" required><label>O que foi feito / devolutiva</label>',1)
s=s.replace("treatModalV7.classList.add('open');", "document.getElementById('actionAtK17').value=qoeLocalInputK17();treatModalV7.classList.add('open');",1)
s=s.replace("qoeRpc('gestao_registrar_tratativa',{", "qoeRpc('gestao_registrar_tratativa_k17',{p_atuada_em:qoeActionIsoK17('actionAtK17'),")
# Informa erro de data sem deixar uma rejeição de Promise solta no formulário.
s=s.replace(" if(qoeCloudReady&&p&&manager&&type&&ret){", " let actedK17;try{actedK17=qoeActionIsoK17('actionAtK17');}catch(e){return alert(e.message);}\n if(qoeCloudReady&&p&&manager&&type&&ret){",1)
s=s.replace("p_atuada_em:qoeActionIsoK17('actionAtK17')", 'p_atuada_em:actedK17',1)
# Relatório adicional: mantém todos os indicadores operacionais já existentes.
panel='''<div class="panel" id="weeklyTechReportK17"><h2>Execução e resultado por técnico</h2><div id="techReportNoteK17" class="sub"></div><div class="wrap"><table><thead><tr><th>Técnico</th><th>Herdadas</th><th>Novas</th><th>Recebidas</th><th>Atuadas</th><th>Aguardando Gestão</th><th>Validadas</th><th>Estabilizadas</th><th>Retornos</th><th>Acompanhamento</th><th>Pendentes de atuação</th><th>Assertividade</th><th>WhatsApp</th></tr></thead><tbody id="techReportBodyK17"></tbody></table></div></div>'''
idx=s.index('<div class="panel"><h2>Portas alocadas para tratamento')
s=s[:idx]+panel+s[idx:]
baseline=(r/'baseline/gestao.html').read_text()
a=s.index('async function qoeMigrateInitial65(){');b=s.index('const _qoeConfirmAlloc=confirmAlloc;',a)
ba=baseline.index('async function qoeMigrateInitial65(){');bb=baseline.index('const _qoeConfirmAlloc=confirmAlloc;',ba)
s=s[:a]+baseline[ba:bb]+s[b:]
# A saída só é gravada após a aplicação isolada da regra K17.2.
# Portal: endereços e histórico preservados, acrescenta data real e evita envio duplicado.
p=p.replace('<label>Tipo de atuação</label>','<label>Data/hora da atuação (Brasília)</label><input id="actionAtK17" type="datetime-local" required><label>Tipo de atuação</label>',1)
p=p.replace("sb.rpc('portal_tecnico_carteira'", "sb.rpc('portal_tecnico_carteira_k17'")
p=p.replace("async function save(){", "let savingK17=false;function portalActionDateK17(){const s=actionAtK17.value;if(!s)return null;const d=new Date(s+'-03:00');return Number.isFinite(+d)&&d<=new Date()?d.toISOString():null;}\nasync function save(){if(savingK17)return;const acted=portalActionDateK17();if(!acted)return alert('Informe a data/hora real da atuação, sem data futura.');")
p=p.replace("sb.rpc('portal_tecnico_registrar_atuacao',{", "sb.rpc('portal_tecnico_registrar_atuacao_k17',{p_atuada_em:acted,")
p=p.replace("const{error}=await sb.rpc('portal_tecnico_registrar_atuacao_k17'", "savingK17=true;let response;try{response=await sb.rpc('portal_tecnico_registrar_atuacao_k17'",1)
p=p.replace("p_observacao:obs.value.trim()||null});if(error)", "p_observacao:obs.value.trim()||null});}catch(e){return alert('Não foi possível confirmar o envio. Atualize a carteira antes de tentar novamente.');}finally{savingK17=false;}const{error}=response;if(error)",1)
p=p.replace("function openM(id,p){current=id;", "function openM(id,p){actionAtK17.value=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(' ','T');current=id;",1)
p=p.replace("techName=DATA[0]?.tecnico", "const context=await sb.rpc('portal_tecnico_contexto_k17',{p_token:token});if(!context.error){HIST=HIST.map(h=>{const x=(context.data||[]).find(x=>x.tratativa_id===(h.tratativa_id||h.id)||(x.porta===h.porta&&Date.parse(x.criado_em)===Date.parse(h.atuacao_em)));return x?{...h,atuacao_em:x.atuada_em,data_informada:x.data_informada}:h;});}techName=DATA[0]?.tecnico",1)
p=p.replace('<header><h1>QoE HFC — Portal Técnico</h1>','<header><h1>QoE HFC — Portal Técnico</h1><small>K17.1 — em homologação</small>',1)
p=p.replace('${dt(x.atuacao_em)} ${+x.recorrencia', "${dt(x.atuacao_em)} ${x.data_informada?'':'<small>(data legada de registro)</small>'} ${+x.recorrencia",1)
# K17.2: referência automática no servidor; nenhum campo de data editável.
s=s.replace('V7.11.1K17.1','V7.11.1K17.2')
p=p.replace('K17.1 — em homologação','K17.2 — em homologação')
s=s.replace(" let confirmedAction=tr.atuada_em;\n if(!tr.data_informada){try{confirmedAction=qoeActionIsoK17('legacyActionK17-'+id);}catch(e){return alert('Confirme com o técnico a data real da atuação: '+e.message);}}", " const confirmedAction=tr.criado_em;")
s=s.replace("${!tr.data_informada?'<label>Data/hora real conferida com o técnico</label><input type=\"datetime-local\" id=\"legacyActionK17-'+tr.id+'\">':''}", '')
start=s.index('${x.raw?.data_informada===false?`<small>Data real a conferir')
end=s.index('</td>',start)
s=s[:start]+'<small>Data do registro no Portal</small>'+s[end:]
s=s.replace('<label>Data/hora da atuação (Brasília)</label><input type="datetime-local" id="actionAtK17" required>','<small>O acompanhamento usa automaticamente a data/hora deste registro.</small>')
s=s.replace("document.getElementById('actionAtK17').value=qoeLocalInputK17();",'')
s=s.replace(" let actedK17;try{actedK17=qoeActionIsoK17('actionAtK17');}catch(e){return alert(e.message);}", ' const actedK17=null;')
s=s.replace('tr.atuada_em||tr.criado_em','tr.criado_em||tr.atuada_em')
s=s.replace('Acompanhamento iniciado na data real da atuação.','Acompanhamento iniciado na data do registro no Portal.')
p=p.replace('<label>Data/hora da atuação (Brasília)</label><input id="actionAtK17" type="datetime-local" required>','<small>O acompanhamento usa automaticamente a data/hora do registro no Portal.</small>')
a=p.index('let savingK17=false;function portalActionDateK17()');b=p.index('async function save(){',a)
p=p[:a]+'let savingK17=false;\n'+p[b:]
p=p.replace("const acted=portalActionDateK17();if(!acted)return alert('Informe a data/hora real da atuação, sem data futura.');", 'const acted=null;')
a=p.index('actionAtK17.value=new Intl.DateTimeFormat');b=p.index('current=id;',a)
p=p[:a]+p[b:]
# Contrato antigo mantido (p_atuada_em=null); timestamp autoritativo vem do banco.
for phrase in ['Confirmar data real','Data real a conferir','legacyActionK17-','monitorActualK17-','id="actionAtK17"']:
 assert phrase not in s and phrase not in p,phrase
(r/'gestao.html').write_text(s)
(r/'portal.html').write_text(p)

