-- Cómo se liquida cada liquidación (src/components/Liquidacion.js): por hora (días con
-- horas y viajes, como hasta ahora), con un monto fijo por mes, o un trabajo único.
-- Las que ya existen quedan "por hora". Se puede correr más de una vez.

alter table public.liquidaciones
  add column if not exists modalidad text not null default 'horas';

alter table public.liquidaciones drop constraint if exists liquidaciones_modalidad_check;
alter table public.liquidaciones
  add constraint liquidaciones_modalidad_check check (modalidad in ('horas', 'mensual', 'unico'));

-- El monto del mes (mensual) o del trabajo (único). En las por hora no se usa: el
-- total sale de los días.
alter table public.liquidacion_meses
  add column if not exists monto numeric(14,2) not null default 0;

alter table public.liquidacion_meses drop constraint if exists liquidacion_meses_monto_check;
alter table public.liquidacion_meses
  add constraint liquidacion_meses_monto_check check (monto >= 0);
