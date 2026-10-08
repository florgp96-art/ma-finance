-- En qué moneda se liquida cada liquidación (src/components/Liquidacion.js): pesos,
-- dólares o euros. Es de toda la liquidación, así el acumulado no mezcla monedas.
-- Las que ya existen quedan en pesos. Se puede correr más de una vez.

alter table public.liquidaciones
  add column if not exists moneda text not null default 'ARS';

alter table public.liquidaciones drop constraint if exists liquidaciones_moneda_check;
alter table public.liquidaciones
  add constraint liquidaciones_moneda_check check (moneda in ('ARS', 'USD', 'EUR'));
