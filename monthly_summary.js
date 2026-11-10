(function(){
 const pct=v=>v.toFixed(1).replace('.',',')+'%';
 window.renderWeeklyV796=function(){
 const w=qoeWeeklySelectedK165(),x=qoeWeeklyTotalsK165(w);if(!document.getElementById('wkSent'))return;
 if(!x){['wkSent','wkDone','wkPending','wkRate','wkTech'].forEach(id=>document.getElementById(id).textContent='—');wkReading.textContent=qoeMonthlyErrorK18||'Entre na Gestão para carregar o resumo mensal.';return;}
 document.getElementById('wkDone').previousElementSibling.textContent=w.mes?'Portas atuadas':'Portas tratadas (histórico)';
 wkSent.textContent=x.sent;wkDone.textContent=w.mes?x.acted:x.done;wkPending.textContent=x.pending;wkRate.textContent=pct(x.rate);wkTech.textContent=x.active+' de '+x.totalTechs;
 if(document.getElementById('wkNormalized'))wkNormalized.textContent=x.normalized;
 const label=w.mes?'atuadas':'tratadas';
 wkReading.textContent=`${x.label}: ${w.mes?x.acted:x.done} portas ${label} de ${x.sent} recebidas (${pct(x.rate)}). ${x.normalized} normalizaram sem atuação e não contam como produtividade. ${x.pending} pendentes de atuação. ${x.active} de ${x.totalTechs} técnicos registraram atuação no período. Portas com atuação anterior no mês podem também estar pendentes por retorno. ${w.mes?'Atuadas são distintas por porta, independentemente do número de devolutivas.':''}`;
 };
 window.copyWeeklyV796=async function(){
 if(!await qoeWeeklyLoadK165())return alert(qoeMonthlyErrorK18);const w=qoeWeeklySelectedK165(),x=qoeWeeklyTotalsK165(w);if(!x)return;
 const msg=`QOE HFC — ${x.label}\n\nRecebidas: ${x.sent}\n${w.mes?'Atuadas':'Tratadas'}: ${w.mes?x.acted:x.done}\nNormalizadas sem atuação: ${x.normalized}\nPendentes de atuação: ${x.pending}\nNovas: ${x.newPorts}\nExecução: ${pct(x.rate)}\nTécnicos com atuação: ${x.active} de ${x.totalTechs}\n\nNormalização sem atuação não conta como produtividade. Priorize as portas QoE e registre as atuações no Portal.`;
 try{await navigator.clipboard.writeText(msg);alert('Resumo copiado.');}catch{prompt('Copie a mensagem:',msg);}
 };
 document.addEventListener('DOMContentLoaded',()=>setTimeout(window.renderWeeklyV796,500));
})();
