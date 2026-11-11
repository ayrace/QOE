from pathlib import Path
import runpy
r=Path(__file__).parent
runpy.run_path(str(r/'build_k18.py'))
s=(r/'gestao.html').read_text();p=(r/'portal.html').read_text()
s=s.replace('V7.11.1K18.0','V7.11.1K19.0').replace('Distribuição mensal — em homologação','Mensal + acompanhamento automático + MDU — em homologação')
p=p.replace('K18.0 — em homologação','K19.0 — em homologação')
# Encaminhamento e execução são decisões explícitas do técnico no caso MDU.
box='<div id="purposeBoxK19" hidden><label>Este registro é</label><select id="purposeK19"><option value="ENCAMINHAMENTO">Encaminhamento para MDU/Indoor — ainda não executado</option><option value="EXECUTADA">Atuação executada nos endereços informados</option></select></div>'
s=s.replace('id="actionTypeV7"','id="actionTypeV7" onchange="qoePurposeFieldsK19()"')
s=s.replace('<small>O acompanhamento usa automaticamente a data/hora deste registro.</small>',box+'<small>Atuação executada inicia acompanhamento automático. Encaminhamento e pedido de apoio permanecem pendentes.</small>')
s=s.replace("treatModalV7.classList.add('open');", "document.getElementById('purposeK19').value='ENCAMINHAMENTO';qoePurposeFieldsK19();treatModalV7.classList.add('open');",1)
s=s.replace("qoeRpc('gestao_snapshot_k17'", "qoeRpc('gestao_snapshot_k19'")
needle='   window.qoeCloudTratativasV711K10=Array.isArray(data.tratativas)?data.tratativas:[];'
s=s.replace(needle,needle+"\n   window.qoeCloudAllDemandsK19=demandasPorId;qoeMduK19=Array.isArray(data.mdu_enderecos)?data.mdu_enderecos:[];qoeMduRenderK19();",1)
a=s.index('confirmTreatV7=async function(){',s.index('const _qoeConfirmTreat=confirmTreatV7;'));b=s.index('const _qoeRebuild=',a)
s=s[:a]+'''let qoeSavingK19=false;
confirmTreatV7=async function(){
 if(qoeSavingK19)return;
 const p=treatTargetV7,manager=managerV7.value,type=actionTypeV7.value,ret=returnV7.value.trim(),addr=addressV7.value.trim(),obs=obsV7.value.trim();
 if(!p||!manager||!type||!ret)return alert('Informe gestor, tipo e devolutiva.');
 if(['MDU','Indoor'].includes(type)&&!addr)return alert('Informe pelo menos um endereço.');
 if(!await qoeCheckSession())return alert('Entre na Gestão para registrar a atuação.');
 qoeSavingK19=true;
 try{const {data,error}=await qoeRpc('gestao_registrar_tratativa_k19',{p_porta:p,p_gestor_nome:manager,p_tipo:type,p_descricao:ret,p_endereco:addr||null,p_observacao:obs||null,p_finalidade:qoePurposeK19(type,'purposeK19')});
 if(error)throw error;closeTreatV7();await qoeRemoteRefresh();alert(data?.mensagem||'Registro recebido. Acompanhamento automático após execução.');
 }catch(e){alert('Não foi possível confirmar o registro: '+(e.message||e));}finally{qoeSavingK19=false;}
};
''' +s[b:]
# Interface de aprovação substituída por instrução. Funções legadas continuam no código.
a=s.index('<div class="panel" id="pendingReturnsPanelV711K">');b=s.index('<div class="panel"><h2>Devolutivas recebidas',a)
s=s[:a]+'''<div class="panel" id="pendingReturnsPanelV711K"><h2>Fluxo automático após execução</h2><p>Atuação executada segue para acompanhamento na data do registro, sem aprovação manual. Encaminhamentos MDU e pedidos de apoio permanecem pendentes. Sete dias consecutivos ≥80 confirmam estabilização.</p><table hidden><tbody id="pendingReturnsV711K"></tbody></table></div>

''' +s[b:]
s=s.replace('Devolutivas / MDU','Devolutivas')
s=s.replace('Retornos técnicos e demandas MDU/Indoor para análise da Gestão.','Histórico das atuações e devolutivas recebidas. O resultado é confirmado pelas leituras QoE.')
s=s.replace('A atuação não significa estabilização; a porta segue para acompanhamento QoE.','Atuação executada segue para acompanhamento automático; encaminhamento e apoio não contam como execução.')
# Navegação própria MDU, mantendo o histórico da fila original.
s=s.replace('<button class="qoe-nav-btn" data-page="semanal"', '<button class="qoe-nav-btn" data-page="mdu" onclick="qoePage(\'mdu\')">MDU / Indoor</button>\n    <button class="qoe-nav-btn" data-page="semanal"',1)
s=s.replace("else if(p.querySelector('#oscillatingV79'))", "else if(p.id==='mduManagementK19'||p.querySelector('#secondaryV78')) group='mdu';\n     else if(p.querySelector('#oscillatingV79'))",1)
s=s.replace("devolutivas:['Devolutivas',", "mdu:['MDU / Indoor','Endereços, direcionamento e registro de execução por ocorrência.'],\n     devolutivas:['Devolutivas',",1)
s=s.replace('Demandas secundárias geradas a partir das devolutivas técnicas para validação e acompanhamento da Gestão.','Histórico original das demandas secundárias, preservado. O direcionamento por endereço está na lista MDU acima.')
panel='''<div class="panel" id="mduManagementK19"><h2>MDU / Indoor — Endereços e atendimento</h2><p>Encaminhar não significa executar. Cada endereço mantém seu responsável e sua execução. O texto original permanece preservado.</p><details><summary>+ Cadastrar encaminhamento MDU/Indoor</summary><label>Demanda de origem</label><select id="mduDemandK19"></select><label>Tipo</label><select id="mduTypeK19"><option>MDU</option><option>INDOOR</option></select><label>Endereços (um por linha)</label><textarea id="mduAddressesK19" rows="3"></textarea><label>Descrição / tratativa</label><textarea id="mduDescK19" rows="3"></textarea><button onclick="qoeMduCreateK19()">Cadastrar encaminhamento</button></details><div class="toolbar"><input id="mduSearchK19" placeholder="Buscar porta, endereço, técnico ou responsável" oninput="qoeMduRenderK19()"><select id="mduFilterK19" onchange="qoeMduRenderK19()"><option value="">Todos os atendimentos</option><option>PENDENTE</option><option>ENCAMINHADO</option><option>EXECUTADO</option></select><span id="mduCountK19"></span></div><div class="wrap"><table><thead><tr><th>Data</th><th>Porta / Node</th><th>Origem</th><th>Endereço</th><th>Tratativa</th><th>Direcionamento</th><th>Execução</th></tr></thead><tbody id="mduBodyK19"></tbody></table></div></div>
'''
idx=s.index('<div class="panel"><h2>Fila MDU / Indoor');s=s[:idx]+panel+s[idx:]
# Registro da lista distribuída retirado da interface, históricos e RPCs preservados.
s=s.replace('const dist=state.monthlyDistributed?.[qoeMonthlyK18?.mes_atual]?.[n];','const dist=null;')
a=s.index('      <button class="distbtn');b=s.index('\n    </div>',a);s=s[:a]+s[b:]
s=s.replace('<th>Distribuição</th>','<th>Carteira</th>')
s=s.replace("${w.distribuidas?.[t.tecnico]?'Distribuída ✓ '+qoeWeeklyEscapeK165(w.distribuidas[t.tecnico].date):'Não marcada'}", "${w.mes?'Disponível no Portal':(w.distribuidas?.[t.tecnico]?'Distribuída ✓ '+qoeWeeklyEscapeK165(w.distribuidas[t.tecnico].date):'Sem marcação histórica')}")
# Aviso no cartão/linha da porta devolvida ao técnico.
s=s.replace('<td><b>${x.porta}</b></td><td>${hist}', '<td><b>${x.porta}</b>${qoeReturnNoticeK19(x.porta)}</td><td>${hist}',1)
# Relatório mantém o contrato do banco e muda apenas a apresentação do aceite.
s=s.replace('<th>Aguardando Gestão</th>','<th>MDU pendente (atual)</th>').replace('<th>Validadas</th>','<th>Registros aceitos</th>')
s=s.replace('<td>${t.aguardando_validacao}</td><td>${t.validadas}</td>','<td>${t.mdu_pendentes||0}</td><td>${t.validadas}</td>')
s=s.replace('Tratadas = atuações validadas.','Tratadas = atuações executadas aceitas automaticamente.').replace('Há devolutivas aguardando a Gestão','Há pendência de apoio ou encaminhamento')
s=s.replace('Aguardando validação da Gestão: ${t.aguardando_validacao}', 'Endereços MDU pendentes: ${t.mdu_pendentes||0}')
# Funções substituídas são instaladas antes do primeiro rebuild.
needle="let savedOct=localStorage.getItem('qoe_v700_oct');"
s=s.replace(needle,(r/'mdu_client.js').read_text()+'\n'+needle,1)
# Portal: finalidade e mensagem de retorno, preservando múltiplos endereços.
p=p.replace("sb.rpc('portal_tecnico_carteira_k17'", "sb.rpc('portal_tecnico_carteira_k19'")
p=p.replace('onchange="syncAddressRequired()"','onchange="syncAddressRequired();syncPurposeK19()"')
p=p.replace('<label>O que foi feito / devolutiva</label>', '<div id="purposeBoxK19" hidden><label>Este registro é</label><select id="purposeK19"><option value="ENCAMINHAMENTO">Encaminhamento MDU/Indoor — ainda não executado</option><option value="EXECUTADA">Atuação executada nos endereços informados</option></select></div><label>O que foi feito / devolutiva</label>',1)
p=p.replace('O acompanhamento usa automaticamente a data/hora do registro no Portal.','Execução inicia acompanhamento automático. Encaminhamento MDU e apoio permanecem pendentes.')
p=p.replace("sb.rpc('portal_tecnico_registrar_atuacao_k17',{p_atuada_em:acted,", "sb.rpc('portal_tecnico_registrar_atuacao_k19',{p_finalidade:portalPurposeK19(),")
p=p.replace('const{error}=response;', 'const{data:result,error}=response;')
p=p.replace("alert(addresses.length>1?'Devolutiva enviada com '+addresses.length+' endereços para a gestão.':'Devolutiva enviada para a gestão.')", "alert((result?.mensagem||'Registro recebido.')+(addresses.length>1?' '+addresses.length+' endereços preservados.':''))")
p=p.replace("function openM(id,p){current=id;", "function openM(id,p){purposeK19.value='ENCAMINHAMENTO';purposeBoxK19.hidden=true;current=id;",1)
p=p.replace('<div class="scores"><span', "${x.retorno_tratamento?.mensagem?`<div class=\"oscbox\" style=\"color:#b42318\"><b>${escapeK19(x.retorno_tratamento.mensagem)}</b>${x.retorno_tratamento.data_leitura?`<div>Leitura: ${escapeK19(x.retorno_tratamento.data_leitura)} • Nota: ${fmt(x.retorno_tratamento.nota)}</div>`:''}</div>`:''}<div class=\"scores\"><span",1)
p=p.replace('function addAddress(value=', '''function escapeK19(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function syncPurposeK19(){purposeBoxK19.hidden=!['MDU','Indoor'].includes(type.value);}
function portalPurposeK19(){return ['Sem oportunidade','Necessita apoio'].includes(type.value)?'DEVOLUTIVA':['MDU','Indoor'].includes(type.value)?purposeK19.value:'EXECUTADA';}
function addAddress(value=''',1)
(r/'gestao.html').write_text(s);(r/'portal.html').write_text(p)
