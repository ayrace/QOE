// K18: período mensal compartilhado. Sem alocação/avanço automático.
let qoeMonthlyK18=null,qoeMonthlyBusyK18=false,qoeMonthlyErrorK18='';
function qoeMonthLabelK18(m){const [y,mm]=String(m).split('-');return `${mm}/${y}`;}
function qoePeriodLabelK18(w){return w?.mes?'Mês '+qoeMonthLabelK18(w.mes):w?'Semana '+w.semana+' (histórico)':'Período';}
function qoeMonthlyApplyK18(data){
 if(data?.versao!==180||!/^\d{4}-\d{2}$/.test(data.mes_atual||'')||!Array.isArray(data.meses)||!data.meses.some(m=>m.mes===data.mes_atual))throw Error('Resposta mensal inválida.');
 if(qoeMonthlyK18&&Date.parse(data.atualizado_em)<Date.parse(qoeMonthlyK18.atualizado_em))return;
 qoeMonthlyK18=data;qoeMonthlyErrorK18='';
 state.monthlyDistributed=state.monthlyDistributed||{};
 data.meses.forEach(m=>{state.monthlyDistributed[m.mes]=m.distribuidas||{};});
 persist();renderWeeks();renderTechCards();
}
// Os nomes legados permanecem para compatibilidade dos pontos de atualização.
qoeWeeklyLoadK165=async function(){
 if(!await qoeCheckSession()){qoeMonthlyK18=null;qoeMonthlyErrorK18='Entre na Gestão para consultar os meses.';qoeWeeklyErrorK165=qoeMonthlyErrorK18;renderWeeks();return false;}
 try{const {data,error}=await qoeRpc('gestao_mensal_ler_k18');if(error)throw error;qoeMonthlyApplyK18(data);return true;}
 catch(e){qoeMonthlyErrorK18='Controle mensal indisponível. Confira o SQL K18. '+(e.message||e);qoeWeeklyErrorK165=qoeMonthlyErrorK18;renderWeeks();return false;}
};
qoeWeeklySelectedK165=function(){
 if(!qoeMonthlyK18)return null;const v=document.getElementById('weekSel')?.value||qoeMonthlyK18.mes_atual;
 if(v.startsWith('S:'))return (qoeMonthlyK18.semanas_legadas||[]).find(w=>String(w.semana)===v.slice(2))||null;
 return qoeMonthlyK18.meses.find(w=>w.mes===v)||qoeMonthlyK18.meses.find(w=>w.mes===qoeMonthlyK18.mes_atual);
};
qoeWeeklyTotalsK165=function(w){
 if(!w)return null;const t=w.totais;
 if(!t){const x={week:w.semana,label:qoePeriodLabelK18(w),sent:0,done:0,normalized:0,pending:0,newPorts:0,withdrawn:0,unknown:0,active:0,totalTechs:w.tecnicos.length,rate:0};w.tecnicos.forEach(t=>{x.sent+=t.recebidas;x.done+=t.tratadas;x.normalized+=t.normalizadas;x.pending+=t.pendentes;x.newPorts+=t.novas;x.withdrawn+=t.retiradas;x.unknown+=t.sem_leitura;if(t.tratadas>0)x.active++;});x.rate=x.sent?100*x.done/x.sent:0;return x;}
 return {label:qoePeriodLabelK18(w),sent:t.recebidas,done:t.validadas,acted:t.atuadas,normalized:t.normalizadas,pending:t.pendentes,newPorts:t.novas,withdrawn:t.retiradas,unknown:0,active:t.tecnicos_atuantes,totalTechs:t.total_tecnicos,rate:t.recebidas?100*t.atuadas/t.recebidas:0};
};
renderWeeks=function(){
 const sel=document.getElementById('weekSel'),body=document.getElementById('weeklyBody');if(!sel||!body)return;
 if(!qoeMonthlyK18){sel.innerHTML='';body.innerHTML='<tr><td colspan="8">'+qoeWeeklyEscapeK165(qoeMonthlyErrorK18||'Entre na Gestão para carregar o controle mensal.')+'</td></tr>';}
 else{
 const previous=sel.value;const periods=[...qoeMonthlyK18.meses.map(m=>({key:m.mes,label:qoePeriodLabelK18(m)+(m.fechado_em?' — encerrado':' — atual')})),...(qoeMonthlyK18.semanas_legadas||[]).map(w=>({key:'S:'+w.semana,label:qoePeriodLabelK18(w)}))];
 sel.innerHTML=periods.map(p=>`<option value="${p.key}">${p.label}</option>`).join('');sel.value=periods.some(p=>p.key===previous)?previous:qoeMonthlyK18.mes_atual;
 const w=qoeWeeklySelectedK165();body.innerHTML=w.tecnicos.map(t=>`<tr><td><b>${qoeWeeklyEscapeK165(t.tecnico)}</b></td><td>${qoePeriodLabelK18(w)}</td><td>${t.recebidas}</td><td>${t.tratadas}</td><td>${t.normalizadas}</td><td>${t.pendentes}</td><td>${t.novas}</td><td>${w.distribuidas?.[t.tecnico]?'Distribuída ✓ '+qoeWeeklyEscapeK165(w.distribuidas[t.tecnico].date):'Não marcada'}</td></tr>`).join('');
 }
 const note=document.getElementById('weeklySyncK165');const w=qoeWeeklySelectedK165();
 if(note)note.textContent=qoeMonthlyErrorK18||(w?.mes?`${qoePeriodLabelK18(w)} • carteira mensal compartilhada. Pendências herdadas + novas portas escolhidas manualmente.${w.migracao==='MIGRACAO_NOVEMBRO'?' Novembro consolidado na migração: pendências recuperadas, recebimentos e registros de novembro.':''} ${(w.conflitos||[]).length?'ATENÇÃO: '+w.conflitos.length+' porta(s) possuem demandas ativas duplicadas. Nenhuma demanda foi excluída.':''}`:w?'Histórico semanal preservado na migração, somente consulta.':'');
 const warn=document.getElementById('monthlyConflictsK18');if(warn)warn.textContent=w?.mes?(w.conflitos||[]).map(c=>`${c.porta}: ${c.demandas} demandas (${c.tecnicos})`).join(' • '):'';
 if(typeof window.renderWeeklyV796==='function')window.renderWeeklyV796();qoeReportLoadK17();verifyBaseline();
};
newWeek=async function(){return qoeStartNextMonthK18();};
async function qoeStartNextMonthK18(){
 if(qoeMonthlyBusyK18)return;qoeMonthlyBusyK18=true;
 try{if(!await qoeWeeklyLoadK165())return alert(qoeMonthlyErrorK18);
 const m=qoeMonthlyK18.mes_atual;
 if(!confirm('Fechar '+qoeMonthLabelK18(m)+' e iniciar o próximo mês? Somente pendências serão carregadas. Novas portas dependem de distribuição manual.'))return;
 const {data,error}=await qoeRpc('gestao_mensal_iniciar_k18',{p_mes_esperado:m+'-01'});if(error)throw error;
 qoeMonthlyApplyK18(data);document.getElementById('weekSel').value=data.mes_atual;await qoeRemoteRefresh();alert('Mês '+qoeMonthLabelK18(data.mes_atual)+' aberto.');
 }catch(e){alert('Abertura não confirmada: '+(e.message||e));}finally{qoeMonthlyBusyK18=false;}
}
resetWeeklyCount=function(){alert('O histórico é preservado. O mês só muda em Iniciar próximo mês.');};
toggleDistributed=async function(tech){
 if(!await qoeWeeklyLoadK165())return alert(qoeMonthlyErrorK18);
 const m=qoeMonthlyK18.meses.find(x=>x.mes===qoeMonthlyK18.mes_atual),mark=!m.distribuidas?.[tech];
 if(!mark&&!confirm('Remover a marcação de lista distribuída para '+tech+'?'))return;
 const {data,error}=await qoeRpc('gestao_mensal_distribuida_k18',{p_tecnico:tech,p_mes_esperado:m.mes+'-01',p_distribuida:mark});
 if(error)return alert('Marcação não confirmada: '+error.message);qoeMonthlyApplyK18(data);
};
qoeReportLoadK17=async function(){
 const body=document.getElementById('techReportBodyK17');if(!body)return;const w=qoeWeeklySelectedK165();const request=++qoeReportRequestK17;
 if(!w){qoeReportK17=null;body.innerHTML='<tr><td colspan="13">Entre na Gestão para consultar o relatório mensal.</td></tr>';return;}
 if(!w.mes){qoeReportK17=null;body.innerHTML='<tr><td colspan="13">Resumo semanal preservado na tabela acima. O relatório de resultado passa a ser mensal a partir de novembro.</td></tr>';return;}
 // Relatório e tabela usam a mesma resposta de banco, sem uma segunda leitura concorrente.
 qoeReportK17=w;
 document.getElementById('techReportNoteK17').textContent=qoePeriodLabelK18(w)+' • Atuadas = portas com atuação registrada no mês. Tratadas = atuações validadas. Assertividade = estabilizadas ÷ (estabilizadas + retornos). Acompanhamentos não entram nesse denominador. Contagens por técnico podem repetir uma porta transferida; o resumo geral conta portas físicas distintas.';
 body.innerHTML=w.tecnicos.map((t,i)=>`<tr${t.sem_atuacao?' style="background:#fff1f2"':''}><td><b>${qoeWeeklyEscapeK165(t.tecnico)}</b><br><small>${t.sem_atuacao?'SEM ATUAÇÃO NO MÊS':t.aguardando_validacao?'Há devolutivas aguardando a Gestão':'Execução registrada ou sem pendência de atuação'}</small></td><td>${t.herdadas}</td><td>${t.novas}</td><td>${t.recebidas}</td><td>${t.atuadas}<br><small>${t.devolutivas} devolutivas</small></td><td>${t.aguardando_validacao}</td><td>${t.validadas}</td><td>${t.estabilizadas}</td><td>${t.retornos}</td><td>${t.acompanhamento}</td><td>${t.pendentes}</td><td>${t.assertividade==null?'Aguardando resultado':t.assertividade+'%'}${t.acompanhamento||t.aguardando_validacao?'<br><small>Parcial</small>':''}</td><td><button onclick="qoeCopyChargeK17(${i})">Copiar cobrança</button></td></tr>`).join('');
};
qoeCopyChargeK17=async function(i){
 const t=qoeReportK17?.tecnicos?.[i];if(!t)return;
 const msg=`Olá, ${t.tecnico}. Acompanhamento QoE de ${qoeMonthLabelK18(qoeReportK17.mes)}.\n\nHerdadas: ${t.herdadas}\nNovas recebidas: ${t.novas}\nAtuadas no mês: ${t.atuadas}\nAguardando validação da Gestão: ${t.aguardando_validacao}\nPendentes: ${t.pendentes}\n\n${t.sem_atuacao?'Não identificamos atuação registrada no mês. Precisamos avançar nas portas pendentes.':'Precisamos avançar nas pendências.'}\n${(t.portas_pendentes||[]).join(', ')||'Sem porta pendente.'}\n\nRegistre a atuação e a devolutiva no Portal. O acompanhamento parte da data/hora do registro.`;
 try{await navigator.clipboard.writeText(msg);alert('Mensagem copiada.');}catch{prompt('Copie a mensagem:',msg);}
};
function qoeCurrentMonthActionsK18(){
 const w=qoeMonthlyK18?.meses.find(m=>m.mes===qoeMonthlyK18.mes_atual);const t=w?.totais;
 return t?{treated:t.atuadas,stable:t.estabilizadas,monitoring:t.acompanhamento,returned:t.retornos}:{treated:null,stable:null,monitoring:null,returned:null};
}
