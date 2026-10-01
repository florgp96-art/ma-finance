-- Si se facturó cada ingreso (src/lib/facturacion.js): 'facturado', 'sin_facturar'
-- o 'no_corresponde'; null = todavía sin indicar. Se puede correr más de una vez.
alter table public.transactions add column if not exists facturacion text
  check (facturacion in ('facturado', 'sin_facturar', 'no_corresponde'));
