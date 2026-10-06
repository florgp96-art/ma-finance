-- Ingresos a futuro: lo que se espera cobrar, anotado dentro de una liquidación
-- (src/lib/ingresosFuturos.js, src/components/IngresosFuturos.js). Tabla propia a
-- propósito: no son movimientos, no tocan saldos ni balances. Se tachan solos
-- cuando el ingreso aparece en una cuenta, o a mano (cobrado_a_mano).
-- Se puede correr más de una vez.

create table if not exists public.ingresos_futuros (
  id              uuid          primary key default gen_random_uuid(),
  user_id         uuid          not null references auth.users(id) on delete cascade,
  liquidacion_id  uuid          not null references public.liquidaciones(id) on delete cascade,
  concepto        text          not null check (char_length(btrim(concepto)) between 1 and 80),
  monto           numeric(14,2) not null check (monto > 0),
  moneda          text          not null default 'ARS' check (moneda in ('ARS', 'USD', 'EUR')),
  fecha           date          not null,
  cobrado_a_mano  boolean       not null default false,
  created_at      timestamptz   not null default now()
);

create index if not exists ingresos_futuros_user_idx on public.ingresos_futuros (user_id);

alter table public.ingresos_futuros enable row level security;

drop policy if exists "cada uno ve sus ingresos a futuro" on public.ingresos_futuros;
create policy "cada uno ve sus ingresos a futuro" on public.ingresos_futuros
  for select using (auth.uid() = user_id);

drop policy if exists "cada uno carga sus ingresos a futuro" on public.ingresos_futuros;
create policy "cada uno carga sus ingresos a futuro" on public.ingresos_futuros
  for insert with check (auth.uid() = user_id and exists (
    select 1 from public.liquidaciones l where l.id = ingresos_futuros.liquidacion_id and l.user_id = auth.uid()));

drop policy if exists "cada uno edita sus ingresos a futuro" on public.ingresos_futuros;
create policy "cada uno edita sus ingresos a futuro" on public.ingresos_futuros
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.liquidaciones l where l.id = ingresos_futuros.liquidacion_id and l.user_id = auth.uid()));

drop policy if exists "cada uno borra sus ingresos a futuro" on public.ingresos_futuros;
create policy "cada uno borra sus ingresos a futuro" on public.ingresos_futuros
  for delete using (auth.uid() = user_id);
