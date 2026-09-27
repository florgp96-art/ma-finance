-- Datos de arranque de la liquidación, solo para florgp96@gmail.com. Correr
-- después de la migración 20260927000000_liquidacion.sql. Es idempotente: un mes
-- que ya tiene total no se toca, y los días de agosto se cargan solo si agosto no
-- tiene ninguno.
do $$
declare
  v_uid     uuid := (select id from auth.users where email = 'florgp96@gmail.com');
  v_agosto  uuid;
  n_meses   integer;
  n_dias    integer;
begin
  if v_uid is null then
    raise exception 'No existe el usuario florgp96@gmail.com';
  end if;

  insert into public.liquidacion_meses (user_id, clave, valor_hora, valor_viatico, valor_jornada, cerrado, total_cerrado)
  select v_uid, m.clave, 7500, 1200, 25000, true, m.total
  from (values
    ('2026-03', 142200::numeric),
    ('2026-04', 584800),
    ('2026-05', 622500),
    ('2026-06', 420000),
    ('2026-07', 431250),
    ('2026-08', 482400)
  ) as m(clave, total)
  -- Si el mes ya existía abierto y sin total (se abrió en la app antes de correr
  -- esto), se cierra con su total; uno que ya tiene total no se toca.
  on conflict (user_id, clave) do update
    set cerrado = true, total_cerrado = excluded.total_cerrado, updated_at = now()
    where public.liquidacion_meses.total_cerrado is null;
  get diagnostics n_meses = row_count;

  select id into v_agosto from public.liquidacion_meses where user_id = v_uid and clave = '2026-08';

  insert into public.liquidacion_dias (mes_id, dia, tipo, horas, viajes)
  select v_agosto, d.dia, 'horas', d.horas, d.viajes
  from (values
    (4, 3::numeric, 2), (5, 3, 2), (6, 7.5, 2), (7, 4, 2), (11, 3, 2), (13, 3, 0), (14, 3, 2), (18, 5, 2),
    (20, 3, 2), (21, 4.5, 2), (24, 3, 1), (25, 3.5, 2), (26, 3, 1), (27, 2.5, 2), (28, 6, 2), (31, 3, 1)
  ) as d(dia, horas, viajes)
  where not exists (select 1 from public.liquidacion_dias x where x.mes_id = v_agosto);
  get diagnostics n_dias = row_count;

  raise notice 'Listo: % meses cargados o cerrados y % días nuevos', n_meses, n_dias;
end $$;

-- Para comprobarlo: 6 meses cerrados, y agosto con 16 días que suman $ 482.400.
select m.clave, m.cerrado, m.total_cerrado,
       count(d.id) as dias,
       coalesce(sum(case when d.tipo = 'jornada' then m.valor_jornada else 0 end
                    + d.horas * m.valor_hora + d.viajes * m.valor_viatico), 0) as total_de_los_dias
from public.liquidacion_meses m
left join public.liquidacion_dias d on d.mes_id = m.id
where m.user_id = (select id from auth.users where email = 'florgp96@gmail.com')
group by m.id
order by m.clave;
