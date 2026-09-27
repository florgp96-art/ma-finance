-- Liquidación del sueldo mensual de la empleada (src/components/Liquidacion.js).
-- Se corre a mano en Supabase → SQL Editor (ver docs/PENDIENTES.md). Se puede
-- correr más de una vez.

create table if not exists public.liquidacion_meses (
  id             uuid          primary key default gen_random_uuid(),
  user_id        uuid          not null references auth.users(id) on delete cascade,
  clave          text          not null check (clave ~ '^\d{4}-(0[1-9]|1[0-2])$'),  -- 'YYYY-MM'
  valor_hora     numeric(12,2) not null default 7500  check (valor_hora >= 0),
  valor_viatico  numeric(12,2) not null default 1200  check (valor_viatico >= 0),
  valor_jornada  numeric(12,2) not null default 25000 check (valor_jornada >= 0),
  cerrado        boolean       not null default false,
  total_cerrado  numeric(14,2),
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  unique (user_id, clave)
);

create table if not exists public.liquidacion_dias (
  id          uuid         primary key default gen_random_uuid(),
  mes_id      uuid         not null references public.liquidacion_meses(id) on delete cascade,
  dia         smallint     not null check (dia between 1 and 31),
  tipo        text         not null default 'horas' check (tipo in ('horas', 'jornada')),
  horas       numeric(5,2) not null default 0 check (horas >= 0),
  viajes      smallint     not null default 0 check (viajes >= 0),
  created_at  timestamptz  not null default now()
);

create index if not exists liquidacion_dias_mes_idx on public.liquidacion_dias (mes_id);

alter table public.liquidacion_meses enable row level security;
alter table public.liquidacion_dias  enable row level security;

-- Meses: cada uno ve y toca solo los suyos.
drop policy if exists "cada uno ve sus meses de liquidación" on public.liquidacion_meses;
create policy "cada uno ve sus meses de liquidación" on public.liquidacion_meses
  for select using (auth.uid() = user_id);

drop policy if exists "cada uno carga sus meses de liquidación" on public.liquidacion_meses;
create policy "cada uno carga sus meses de liquidación" on public.liquidacion_meses
  for insert with check (auth.uid() = user_id);

drop policy if exists "cada uno edita sus meses de liquidación" on public.liquidacion_meses;
create policy "cada uno edita sus meses de liquidación" on public.liquidacion_meses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cada uno borra sus meses de liquidación" on public.liquidacion_meses;
create policy "cada uno borra sus meses de liquidación" on public.liquidacion_meses
  for delete using (auth.uid() = user_id);

-- Días: solo los de un mes propio. El "with check" del update impide además
-- mover un día a un mes de otra persona cambiándole el mes_id.
drop policy if exists "cada uno ve los días de sus meses" on public.liquidacion_dias;
create policy "cada uno ve los días de sus meses" on public.liquidacion_dias
  for select using (exists (
    select 1 from public.liquidacion_meses m where m.id = liquidacion_dias.mes_id and m.user_id = auth.uid()));

drop policy if exists "cada uno carga días en sus meses" on public.liquidacion_dias;
create policy "cada uno carga días en sus meses" on public.liquidacion_dias
  for insert with check (exists (
    select 1 from public.liquidacion_meses m where m.id = liquidacion_dias.mes_id and m.user_id = auth.uid()));

drop policy if exists "cada uno edita los días de sus meses" on public.liquidacion_dias;
create policy "cada uno edita los días de sus meses" on public.liquidacion_dias
  for update
  using (exists (
    select 1 from public.liquidacion_meses m where m.id = liquidacion_dias.mes_id and m.user_id = auth.uid()))
  with check (exists (
    select 1 from public.liquidacion_meses m where m.id = liquidacion_dias.mes_id and m.user_id = auth.uid()));

drop policy if exists "cada uno borra los días de sus meses" on public.liquidacion_dias;
create policy "cada uno borra los días de sus meses" on public.liquidacion_dias
  for delete using (exists (
    select 1 from public.liquidacion_meses m where m.id = liquidacion_dias.mes_id and m.user_id = auth.uid()));
