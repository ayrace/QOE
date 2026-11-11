from pathlib import Path
import runpy,re
r=Path(__file__).parent
# K16.2 congelada + evoluções preservadas + ajuste autorizado de data do registro.
runpy.run_path(str(r/'build_k172.py'))
s=(r/'gestao.html').read_text();p=(r/'portal.html').read_text()
s=s.replace('V7.11.1K17.2 • Fluxo e execução semanal','V7.11.1K18.0 • Distribuição mensal')
s=s.replace('Semanal / Histórico','Mensal / Histórico').replace('Controle semanal, distribuição e histórico operacional.','Carteira mensal, resultados por técnico e histórico semanal preservado.')
s=s.replace("semanal:['semana','histórico'", "semanal:['mensal','semana','histórico'")
s=s.replace('Histórico semanal de distribuição','Distribuição mensal e histórico')
s=s.replace('Acompanhamento iniciado em 09/10/2026. Marco 0: 13 técnicos × 5 portas. Semanas seguintes: pendências + novas portas escolhidas manualmente, sem limite fixo. Cada porta permanece como unidade independente de tratamento.', 'Controle mensal a partir de novembro/2026. Carteira = pendências herdadas + novas portas escolhidas manualmente, sem quantidade fixa. Marco 0 e histórico semanal preservados para consulta.')
s=s.replace('Iniciar próxima semana','Iniciar próximo mês').replace('Zerar contagem semanal','Preservação do histórico')
s=s.replace('<th>Semana</th><th>Portas recebidas', '<th>Período</th><th>Portas recebidas').replace('<th>Novas na semana</th>','<th>Novas no período</th>')
s=s.replace('<div id="weeklySyncK165" class="sub" role="status"></div>', '<div id="weeklySyncK165" class="sub" role="status"></div><div id="monthlyConflictsK18" style="color:#b42318" role="status"></div>')
s=s.replace('Execução e resultado por técnico','Execução mensal e resultado por técnico')
s=s.replace('Relatório Semanal de Execução QoE','Relatório Mensal de Execução QoE').replace('Resumo para acompanhamento e cobrança da execução semanal.','Resumo para acompanhamento e cobrança mensal. Histórico semanal disponível no seletor de período.')
s=s.replace('<span>Portas tratadas</span><b id="wkDone">','<span>Portas atuadas</span><b id="wkDone">')
s=s.replace('<span>Técnicos com devolutivas</span><b id="wkTech">','<span>Técnicos com atuação</span><b id="wkTech">')
s=s.replace('<span>Tratadas</span><b id="mgrTreated">','<span>Atuadas no mês</span><b id="mgrTreated">')
s=s.replace('Novas degradações na semana','Novas degradações estimadas no mês').replace('fim da semana vs início','fim do período vs início do mês').replace('Ganho diário na semana','Ganho diário no mês')
# Cartões usam marcação mensal separada das antigas marcações semanais.
s=s.replace('const dist=state.distributed&&state.distributed[key];', 'const dist=state.monthlyDistributed?.[qoeMonthlyK18?.mes_atual]?.[n];')
s=s.replace('Atenção: a base semanal não está em 5 portas por técnico.','Marco 0 histórico disponível. A carteira mensal não possui quantidade fixa por técnico.')
# Copiar carteira usa sempre mês aberto, mesmo consultando um histórico.
s=s.replace('const w=qoeWeeklyDataK165.semanas.find(w=>w.semana===qoeWeeklyDataK165.semana_atual);','const w=qoeMonthlyK18.meses.find(w=>w.mes===qoeMonthlyK18.mes_atual);')
s=s.replace("out+='\\nSemana '+w.semana+'\\n';", "out+='\\nMês '+qoeMonthLabelK18(w.mes)+'\\n';")
s=s.replace('Novas nesta semana:','Novas no mês:').replace('resumo semanal e link individual','resumo mensal e link individual')
# Somente o botão explícito de alocar faz a RPC de distribuição.
s=s.replace("   const {error}=await qoeRpc('gestao_semanal_alocar'", "   const previousK18=window.qoeCloudDemandByPortV711K10?.[p];\n   const transferK18=!!(previousK18?.tecnico&&previousK18.tecnico!==t&&['PENDENTE','RECORRENTE'].includes(previousK18.status));\n   if(transferK18&&!confirm('Transferir '+p+' de '+previousK18.tecnico+' para '+t+'? O histórico e o recebimento anterior serão preservados.'))return;\n   const {error}=await qoeRpc('gestao_semanal_alocar'",1)

s=s.replace("qoeRpc('gestao_semanal_alocar',{p_porta:p,p_tecnico:t,p_semana_esperada:qoeWeeklyDataK165.semana_atual})", "qoeRpc('gestao_mensal_alocar_k18',{p_porta:p,p_tecnico:t,p_mes_esperado:qoeMonthlyK18.mes_atual+'-01',p_substituir:transferK18})")
s=s.replace("qoeCloudReady=false;qoeWeeklyDataK165=null;", "qoeCloudReady=false;qoeMonthlyK18=null;qoeMonthlyErrorK18='Entre na Gestão para consultar os meses.';qoeWeeklyDataK165=null;")
# Não escreve em currentWeek nem apaga o estado/histórico do usuário na migração mensal.
needle="let savedOct=localStorage.getItem('qoe_v700_oct');"
s=s.replace(needle,(r/'monthly_client.js').read_text()+'\n'+needle,1)
a=s.index('<script id="v796-weekly-report">');b=s.index('</script>',a)
s=s[:a]+'<script id="v796-weekly-report">\n'+(r/'monthly_summary.js').read_text()+s[b:]
# Indicadores gerenciais passam a usar resultados mensais do banco, não o ledger semanal local.
a=s.index(' function weekActions(){');b=s.index(' function svgChart(series)',a)
s=s[:a]+''' function weekActions(){return qoeCurrentMonthActionsK18();}
'''+s[b:]
s=s.replace('   // Projeto iniciado em 09/10; se a base ainda não chegou ao dia 9, usa o primeiro dia carregado.\n   const max=series.at(-1)?.day||1;\n   return max>=9?9:series[0]?.day||1;', '   return series[0]?.day||1;')
s=s.replace('${d.day}/10','${d.day}/${(document.getElementById("reportMonthK17")?.value||"2026-11").slice(5)}')
s=s.replace('Portas tratadas: ${m.a.treated}', 'Portas atuadas: ${m.a.treated}').replace('Tratadas ${m.a.treated}', 'Atuadas ${m.a.treated}')
s=s.replace('RESULTADO DA SEMANA','RESULTADO DO MÊS').replace('Resumo semanal','Resumo mensal').replace('resumo semanal','resumo mensal').replace('semana atual','mês atual').replace('comparação semanal','comparação mensal').replace('resumo_semanal.png','resumo_mensal.png')
# O Portal já é carteira contínua; não possui regra de distribuição semanal a substituir.
p=p.replace('K17.2 — em homologação','K18.0 — em homologação')
assert 'qoeRpc(\'gestao_mensal_alocar_k18\'' in s
(r/'gestao.html').write_text(s);(r/'portal.html').write_text(p)
