-- Varias liquidaciones por persona, cada una con su nombre (src/components/Liquidacion.js).
-- Antes había una sola, sin nombre: la del sueldo de la empleada, que se veía como si
-- fuera la liquidación de la dueña de la cuenta. Ahora cada una dice qué es y si es
-- plata que se paga (la empleada) o que se cobra (un trabajo propio).
--
-- Las filas de liquidacion_meses que ya existían pasan a una liquidación "Sueldo de la
-- empleada" por usuario. Se puede correr más de una vez.

create table if not exists public.liquidaciones (
  id          uuid         primary key default gen_random_uuid(),
  user_id     uuid         not null references auth.users(id) on delete cascade,
  nombre      text         not null check (char_length(btrim(nombre)) between 1 and 60),
  tipo        text         not null default 'pago' check (tipo in ('pago', 'cobro')),  -- pago: la pagás vos; cobro: te la pagan
  created_at  timestamptz  not null default now()
);

create index if not exists liquidaciones_user_idx on public.liquidaciones (user_id);

alter table public.liquidaciones enable row level security;

drop policy if exists "cada uno ve sus liquidaciones" on public.liquidaciones;
create policy "cada uno ve sus liquidaciones" on public.liquidaciones
  for select using (auth.uid() = user_id);

drop policy if exists "cada uno carga sus liquidaciones" on public.liquidaciones;
create policy "cada uno carga sus liquidaciones" on public.liquidaciones
  for insert with check (auth.uid() = user_id);

drop policy if exists "cada uno edita sus liquidaciones" on public.liquidaciones;
create policy "cada uno edita sus liquidaciones" on public.liquidaciones
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cada uno borra sus liquidaciones" on public.liquidaciones;
create policy "cada uno borra sus liquidaciones" on public.liquidaciones
  for delete using (auth.uid() = user_id);

-- Cada mes es de una liquidación. Borrar la liquidación se lleva sus meses (y los
-- días de esos meses, por el cascade que ya tenía liquidacion_dias).
alter table public.liquidacion_meses
  add column if not exists liquidacion_id uuid references public.liquidaciones(id) on delete cascade;

insert into public.liquidaciones (user_id, nombre, tipo)
select distinct m.user_id, 'Sueldo de la empleada', 'pago'
from public.liquidacion_meses m
where m.liquidacion_id is null
  and not exists (select 1 from public.liquidaciones l where l.user_id = m.user_id);

update public.liquidacion_meses m
set liquidacion_id = (
  select l.id from public.liquidaciones l where l.user_id = m.user_id order by l.created_at, l.id limit 1)
where m.liquidacion_id is null;

alter table public.liquidacion_meses alter column liquidacion_id set not null;

-- Un mes por liquidación, no por persona: dos liquidaciones tienen cada una su septiembre.
alter table public.liquidacion_meses drop constraint if exists liquidacion_meses_user_id_clave_key;
create unique index if not exists liquidacion_meses_liquidacion_clave_key
  on public.liquidacion_meses (liquidacion_id, clave);

-- Un mes solo puede colgar de una liquidación propia: sin esto se podría crear (o
-- mover) un mes en la liquidación de otra persona.
drop policy if exists "cada uno carga sus meses de liquidación" on public.liquidacion_meses;
create policy "cada uno carga sus meses de liquidación" on public.liquidacion_meses
  for insert with check (auth.uid() = user_id and exists (
    select 1 from public.liquidaciones l where l.id = liquidacion_meses.liquidacion_id and l.user_id = auth.uid()));

drop policy if exists "cada uno edita sus meses de liquidación" on public.liquidacion_meses;
create policy "cada uno edita sus meses de liquidación" on public.liquidacion_meses
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.liquidaciones l where l.id = liquidacion_meses.liquidacion_id and l.user_id = auth.uid()));
