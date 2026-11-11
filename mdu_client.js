// K19: MDU por endereço, sem aprovação manual de atuação.
let qoeMduK19=[],qoeMduBusyK19=new Set();
function qoePurposeK19(type,id){const s=String(type||'').toUpperCase();if(['SEM OPORTUNIDADE','SEM_OPORTUNIDADE','NECESSITA APOIO','NECESSITA_APOIO'].includes(s))return 'DEVOLUTIVA';return ['MDU','INDOOR'].includes(s)?document.getElementById(id).value:'EXECUTADA';}
function qoePurposeFieldsK19(){const t=document.getElementById('actionTypeV7')?.value;const box=document.getElementById('purposeBoxK19');if(box)box.hidden=!['MDU','Indoor'].includes(t);}
function qoeReturnNoticeK19(porta){const a=window.qoeCloudDemandByPortV711K10?.[porta]?.retorno_tratamento;return a?.mensagem?`<small style="color:#b42318;font-weight:700">${escV78(a.mensagem)}</small>`:'';}
renderPendingReturnsV711K=function(){const e=document.getElementById('pendingReturnsV711K');if(e)e.innerHTML='';};
// O histórico recebido vem do banco, independente de validação ou localStorage.
renderReturnsV78=function(){
 ensureV7();const el=document.getElementById('returnsV78');if(!el)return;
 const mapped=window.qoeCloudAllDemandsK19||{};
 const trs=window.qoeCloudTratativasV711K10||[];
 const cloud=trs.map(t=>{const d=mapped[t.demanda_id]||Object.values(window.qoeCloudDemandByPortV711K10||{}).find(d=>d.demanda_id===t.demanda_id)||{};return {cloudTratativaId:t.id,date:qoeFmtCloudDateV711K(t.criado_em),tech:t.tecnico||d.tecnico||'—',porta:t.porta||d.porta||'—',type:t.tipo,returnText:t.descricao,address:t.endereco,obs:t.observacao,manager:t.gestor||d.gestor,finalidade:t.finalidade};});
 const ids=new Set(cloud.map(x=>x.cloudTratativaId));const rows=[...cloud,...(state.history||[]).filter(h=>(h.returnText||h.type)&&!ids.has(h.cloudTratativaId))];
 el.innerHTML=rows.length?rows.map(h=>`<tr><td>${escV78(histDateV78(h))}</td><td>${escV78(h.tech)}</td><td><b>${escV78(h.porta)}</b></td><td>${escV78(String(h.type||'').replaceAll('_',' '))}<small>${escV78(h.finalidade||'Registro anterior')}</small></td><td>${escV78(h.returnText||'—')}</td><td>${escV78(h.address||'—')}</td><td>${escV78(h.obs||'—')}</td><td>${escV78(h.manager||'—')}</td></tr>`).join(''):'<tr><td colspan="8">Nenhuma devolutiva recebida.</td></tr>';
};
function qoeMduRenderK19(){
 const body=document.getElementById('mduBodyK19');if(!body)return;
 const status=document.getElementById('mduFilterK19')?.value||'';const search=(document.getElementById('mduSearchK19')?.value||'').toLowerCase();
 const rows=qoeMduK19.filter(r=>(!status||r.situacao===status)&&(!search||[r.porta,r.node,r.endereco,r.responsavel,r.tecnico].join(' ').toLowerCase().includes(search)));
 document.getElementById('mduCountK19').textContent=rows.length+' endereço(s) nesta visão';
 body.innerHTML=rows.length?rows.map(r=>`<tr><td>${escV78(qoeFmtCloudDateV711K(r.criada_em))}</td><td><b>${escV78(r.porta)}</b><small>${escV78(r.node||'')}</small></td><td>${escV78(r.tecnico||'—')}<small>Origem: ${escV78(r.demanda_origem_id)}</small></td><td>${escV78(r.tipo)}<br><b>${escV78(r.endereco)}</b><details><summary>Endereços originais</summary>${escV78(r.endereco_original)}</details></td><td>${escV78(r.descricao||'—')}<small>Tratativa de origem: ${escV78(r.tratativa_origem_id||'cadastro da Gestão')}</small></td><td><input aria-label="Responsável" id="mduOwnerK19-${r.id}" value="${escV78(r.responsavel||'')}" ${r.executada_em?'disabled':''}><button ${r.executada_em?'disabled':''} onclick="qoeMduDirectK19('${r.id}')">Salvar direcionamento</button><button onclick="qoeMduCopyK19('${r.id}')">Copiar endereço</button></td><td><b>${escV78(r.situacao)}</b><small>Status de origem: ${escV78(r.status_origem||'—')}</small>${r.executada_em?`<small>${escV78(qoeFmtCloudDateV711K(r.executada_em))}</small><div>${escV78(r.descricao_execucao||'')}</div>`:`<textarea id="mduExecutionK19-${r.id}" placeholder="Descreva a execução recebida da equipe"></textarea><button onclick="qoeMduExecuteK19('${r.id}')">Registrar execução</button>`}</td></tr>`).join(''):'<tr><td colspan="7">Nenhum endereço nesta visão.</td></tr>';
 const sel=document.getElementById('mduDemandK19');const previous=sel.value;
 const demands=Object.values(window.qoeCloudAllDemandsK19||{}).filter(d=>['PENDENTE','RECORRENTE'].includes(d.status)&&!d.observacao_pre_atuacao);
 sel.innerHTML='<option value="">Selecione porta / demanda de origem</option>'+demands.map(d=>`<option value="${escV78(d.demanda_id)}">${escV78(d.porta)} — ${escV78(d.tecnico||'')}</option>`).join('');if(demands.some(d=>d.demanda_id===previous))sel.value=previous;
}
async function qoeMduActionK19(key,rpc,args){
 if(qoeMduBusyK19.has(key))return;qoeMduBusyK19.add(key);
 try{const {data,error}=await qoeRpc(rpc,args);if(error)throw error;await qoeRemoteRefresh();if(data?.mensagem)alert(data.mensagem);return data;}
 catch(e){alert('Não foi possível confirmar: '+(e.message||e));}
 finally{qoeMduBusyK19.delete(key);}
}
async function qoeMduDirectK19(id){const r=qoeMduK19.find(r=>r.id===id);if(!r)return;const name=document.getElementById('mduOwnerK19-'+id).value.trim();if(!name)return alert('Informe responsável ou equipe.');return qoeMduActionK19(id,'gestao_mdu_direcionar_k19',{p_endereco:id,p_responsavel:name,p_versao:r.versao});}
async function qoeMduExecuteK19(id){const r=qoeMduK19.find(r=>r.id===id);if(!r)return;const desc=document.getElementById('mduExecutionK19-'+id).value.trim();if(!r.responsavel)return alert('Salve primeiro o responsável pelo atendimento.');if(!desc)return alert('Descreva a execução.');if(!confirm('Registrar a execução deste endereço? Outros endereços pendentes permanecem na fila.'))return;return qoeMduActionK19(id,'gestao_mdu_executar_k19',{p_endereco:id,p_descricao:desc,p_versao:r.versao});}
async function qoeMduCreateK19(){const demand=document.getElementById('mduDemandK19').value,desc=document.getElementById('mduDescK19').value.trim(),addresses=document.getElementById('mduAddressesK19').value.split('\n').map(x=>x.trim()).filter(Boolean);if(!demand||!desc||!addresses.length)return alert('Informe demanda de origem, descrição e pelo menos um endereço.');const data=await qoeMduActionK19('novo','gestao_mdu_cadastrar_k19',{p_demanda:demand,p_tipo:document.getElementById('mduTypeK19').value,p_enderecos:addresses,p_descricao:desc});if(data){document.getElementById('mduDescK19').value='';document.getElementById('mduAddressesK19').value='';alert('Endereços incluídos na fila MDU/Indoor.');}}
async function qoeMduCopyK19(id){const r=qoeMduK19.find(r=>r.id===id);if(!r)return;const msg=`MDU/Indoor — ${r.porta}\nNode: ${r.node||'—'}\nEndereço: ${r.endereco}\nResponsável: ${r.responsavel||'A definir'}\nDescrição: ${r.descricao||'—'}`;try{await navigator.clipboard.writeText(msg);alert('Endereço copiado.');}catch{prompt('Copie:',msg);}}
