-- QOE HFC — K6
-- Fluxo da Gestão: VALIDAR ATUAÇÃO ou DEVOLVER PARA TRATAMENTO
-- Execute este arquivo no SQL Editor do Supabase antes de testar a K6.
-- Não altera tabelas, constraints ou RLS. Apenas cria duas RPCs SECURITY DEFINER.

create or replace function public.gestao_validar_atuacao(
  p_demanda_id uuid,
  p_tratativa_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_gestor uuid;
  v_porta_id uuid;
  v_status text;
begin
  v_gestor := public.qoe_gestor_atual();
  if v_gestor is null then
    raise exception 'Usuário não autorizado para gestão';
  end if;

  select d.porta_id, d.status
    into v_porta_id, v_status
  from public.demandas d
  where d.id = p_demanda_id
  for update;

  if v_porta_id is null then
    raise exception 'Demanda não localizada';
  end if;

  if v_status <> 'ATUACAO_REGISTRADA' then
    raise exception 'Demanda não está aguardando validação. Status atual: %', v_status;
  end if;

  if not exists (
    select 1 from public.tratativas tr
    where tr.id = p_tratativa_id
      and tr.demanda_id = p_demanda_id
  ) then
    raise exception 'Tratativa não pertence à demanda informada';
  end if;

  update public.demandas
     set status = 'MONITORAMENTO'
   where id = p_demanda_id;

  insert into public.historico
    (porta_id, demanda_id, origem, usuario_nome, evento, detalhes)
  values
    (
      v_porta_id,
      p_demanda_id,
      'GESTAO',
      coalesce(auth.jwt()->>'email','Gestão'),
      'ATUACAO_VALIDADA',
      jsonb_build_object(
        'tratativa_id', p_tratativa_id,
        'decisao', 'VALIDAR_ATUACAO',
        'status_anterior', 'ATUACAO_REGISTRADA',
        'status_novo', 'MONITORAMENTO',
        'validada_em', now()
      )
    );

  return jsonb_build_object(
    'ok', true,
    'demanda_id', p_demanda_id,
    'tratativa_id', p_tratativa_id,
    'status', 'MONITORAMENTO'
  );
end
$function$;


create or replace function public.gestao_devolver_tratamento(
  p_demanda_id uuid,
  p_tratativa_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_gestor uuid;
  v_porta_id uuid;
  v_tecnico_id uuid;
  v_status text;
begin
  v_gestor := public.qoe_gestor_atual();
  if v_gestor is null then
    raise exception 'Usuário não autorizado para gestão';
  end if;

  select d.porta_id, d.tecnico_id, d.status
    into v_porta_id, v_tecnico_id, v_status
  from public.demandas d
  where d.id = p_demanda_id
  for update;

  if v_porta_id is null then
    raise exception 'Demanda não localizada';
  end if;

  if v_tecnico_id is null then
    raise exception 'Demanda sem técnico responsável';
  end if;

  if v_status <> 'ATUACAO_REGISTRADA' then
    raise exception 'Demanda não está aguardando validação. Status atual: %', v_status;
  end if;

  if not exists (
    select 1 from public.tratativas tr
    where tr.id = p_tratativa_id
      and tr.demanda_id = p_demanda_id
  ) then
    raise exception 'Tratativa não pertence à demanda informada';
  end if;

  -- O técnico_id NÃO é alterado: a porta volta ao mesmo técnico.
  update public.demandas
     set status = 'PENDENTE'
   where id = p_demanda_id;

  insert into public.historico
    (porta_id, demanda_id, origem, usuario_nome, evento, detalhes)
  values
    (
      v_porta_id,
      p_demanda_id,
      'GESTAO',
      coalesce(auth.jwt()->>'email','Gestão'),
      'ATUACAO_DEVOLVIDA_TRATAMENTO',
      jsonb_build_object(
        'tratativa_id', p_tratativa_id,
        'decisao', 'DEVOLVER_TRATAMENTO',
        'tecnico_id_mantido', v_tecnico_id,
        'status_anterior', 'ATUACAO_REGISTRADA',
        'status_novo', 'PENDENTE',
        'devolvida_em', now()
      )
    );

  return jsonb_build_object(
    'ok', true,
    'demanda_id', p_demanda_id,
    'tratativa_id', p_tratativa_id,
    'tecnico_id', v_tecnico_id,
    'status', 'PENDENTE'
  );
end
$function$;

grant execute on function public.gestao_validar_atuacao(uuid,uuid) to authenticated;
grant execute on function public.gestao_devolver_tratamento(uuid,uuid) to authenticated;
