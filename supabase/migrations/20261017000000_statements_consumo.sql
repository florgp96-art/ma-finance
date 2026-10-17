-- Lo que se consumió en el período de cada resumen de tarjeta (compras, cuotas,
-- impuestos y cargos, menos devoluciones), en pesos y en dólares. No es el total a
-- pagar (total_resumen / total_dolares): ese arrastra el saldo del resumen anterior y
-- ya viene con los pagos restados, así que un pago adelantado lo baja aunque se haya
-- gastado lo mismo. Lo calcula la app al importar el PDF (consumoDelResumen en
-- src/lib/controlLectura.js) y lo dibuja "Total facturado por resumen". En los
-- resúmenes viejos queda en null y se sigue mostrando el total. Se puede correr más
-- de una vez.

alter table public.statements
  add column if not exists consumo_pesos numeric,
  add column if not exists consumo_dolares numeric;
