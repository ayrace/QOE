// K17 — correções de fluxo; nenhuma distribuição automática.
let qoePortasResumoK17=null,qoeReportK17=null,qoeReportRequestK17=0;
function qoeXmlTagsK17(parent,name){return [...parent.getElementsByTagNameNS('*',name)];}
function qoeLocalInputK17(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(' ','T');}
function qoeActionIsoK17(id){const v=document.getElementById(id)?.value;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v||''))throw Error('Informe a data e hora da atuação.');const d=new Date(v+'-03:00');if(!Number.isFinite(+d)||d>new Date())throw Error('Data/hora inválida ou futura.');return d.toISOString();}
async function qoeConfirmMonitorDateK17(id){
 let date;try{date=qoeActionIsoK17('monitorActualK17-'+id);}catch(e){return alert(e.message);}
 const {data,error}=await qoeRpc('gestao_confirmar_data_atuacao_k17',{p_tratativa_id:id,p_atuada_em:date});
 if(error)return alert('Data não confirmada: '+error.message);
 await qoeRemoteRefresh();alert(data?.status==='PENDENTE'?'Data confirmada. Leitura pós-atuação abaixo de 80: porta devolvida ao técnico.':data?.status==='ESTABILIZADA'?'Data confirmada. Sete dias reais consecutivos confirmam estabilização.':'Data confirmada. Acompanhamento continua com as leituras reais disponíveis.');
}
function qoeMonthK17(){const value=document.getElementById('reportMonthK17')?.value;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value||''))throw Error('Selecione o mês do relatório.');return value;}
async function qoeReportLoadK17(){
 const panel=document.getElementById('techReportBodyK17');if(!panel)return;
 if(!qoeWeeklyDataK165){qoeReportK17=null;panel.innerHTML='<tr><td colspan="13">Entre na Gestão para carregar o relatório.</td></tr>';return;}
 const w=qoeWeeklySelectedK165();if(!w)return;const request=++qoeReportRequestK17;
 const {data,error}=await qoeRpc('gestao_relatorio_tecnicos_k17',{p_semana:w.semana});
 if(request!==qoeReportRequestK17)return;
 if(error){qoeReportK17=null;panel.innerHTML='<tr><td colspan="13">'+escV78('Não foi possível carregar: '+error.message)+'</td></tr>';return;}
 qoeReportK17=data;
 const rows=data.tecnicos||[];
 document.getElementById('techReportNoteK17').textContent='Semana '+data.semana+' • resultados das atuações desta semana, atualizados após o fechamento. Assertividade = estabilizadas ÷ (estabilizadas + retornos). Casos em acompanhamento não entram no denominador.';
 panel.innerHTML=rows.map((t,i)=>`<tr${t.sem_atuacao?' style="background:#fff1f2"':''}><td><b>${escV78(t.tecnico)}</b><br><small>${t.sem_atuacao?'SEM ATUAÇÃO REAL NA SEMANA':t.aguardando_validacao?'Há devolutivas aguardando a Gestão':'Execução registrada ou sem pendência de atuação'}</small>${t.datas_legadas?'<br><small>Há datas legadas de registro; data real não informada.</small>':''}</td><td>${t.herdadas}</td><td>${t.novas}</td><td>${t.recebidas}</td><td>${t.atuadas}<br><small>${t.devolutivas} devolutivas</small></td><td>${t.aguardando_validacao}</td><td>${t.validadas}</td><td>${t.estabilizadas}</td><td>${t.retornos}</td><td>${t.acompanhamento}</td><td>${t.pendentes}</td><td>${t.assertividade==null?'Aguardando resultado':t.assertividade+'%'}${t.acompanhamento||t.aguardando_validacao?'<br><small>Parcial</small>':''}</td><td><button onclick="qoeCopyChargeK17(${i})">Copiar cobrança</button></td></tr>`).join('');
}
async function qoeCopyChargeK17(i){
 const t=qoeReportK17?.tecnicos?.[i];if(!t)return;
 const message=`Olá, ${t.tecnico}. Segue o acompanhamento QoE da semana ${qoeReportK17.semana}.\n\nPendências herdadas: ${t.herdadas}\nNovas recebidas: ${t.novas}\nPortas com atuação real na semana: ${t.atuadas}\nDevolutivas aguardando validação da Gestão: ${t.aguardando_validacao}\nPendentes de atuação: ${t.pendentes}\n\n${t.sem_atuacao?'Não identificamos atuação real registrada para esta semana. Precisamos avançar nas portas pendentes.':'Precisamos avançar nas pendências abaixo.'}\n${(t.portas_pendentes||[]).join(', ')||'Sem porta pendente de atuação.'}\n\nRegistre a data real da atuação e a devolutiva no Portal. Se houver impedimento ou necessidade de apoio, sinalize à Gestão.`;
 try{await navigator.clipboard.writeText(message);alert('Mensagem copiada.');}catch{prompt('Copie a mensagem:',message);}
}
