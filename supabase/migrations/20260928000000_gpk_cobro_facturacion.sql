-- Cobrado / pagado y facturado por movimiento. Por ahora los botones se ven solo en la
-- cuenta de GPK (config/features.js), pero las columnas son de todos: arrancan en false,
-- así que para el resto de las cuentas no cambia nada.
--   pendiente: el ingreso todavía no se cobró / el gasto todavía no se pagó.
--              Mientras esté pendiente no suma al saldo de la cuenta.
--   facturado: ya se hizo la factura de ese movimiento.
alter table public.transactions
  add column if not exists pendiente boolean not null default false,
  add column if not exists facturado boolean not null default false;

-- Cobros esperados de GPK para la oficina: un ingreso "a cobrar" no cuenta como cobrado.
create or replace view public.gpk_receivables as
 WITH gpk_user AS (
         SELECT users.id
           FROM auth.users
          WHERE ((users.email)::text = 'video33lut@gmail.com'::text)
        ), income AS (
         SELECT t.id,
            t.fecha,
            t.monto,
            COALESCE(t.moneda, 'ARS'::text) AS moneda,
            t.pendiente,
            s.id AS client_id,
            s.nombre AS client_name,
            a.nombre AS account_name
           FROM ((transactions t
             JOIN subcategories s ON ((s.id = t.subcategory_id)))
             LEFT JOIN accounts a ON ((a.id = t.account_id)))
          WHERE ((t.user_id = ( SELECT gpk_user.id
                   FROM gpk_user)) AND (t.tipo = 'ingreso'::text) AND (t.subcategory_id IS NOT NULL) AND (NOT (s.nombre IN ( SELECT gpk_one_off_income_names.name
                   FROM gpk_one_off_income_names))))
        ), recurring AS (
         SELECT income.client_id,
            income.client_name,
            (array_agg(income.account_name ORDER BY income.fecha DESC))[1] AS account_name,
            (array_agg(income.monto ORDER BY income.fecha DESC))[1] AS amount,
            (array_agg(income.moneda ORDER BY income.fecha DESC))[1] AS moneda,
            (min(date_trunc('month'::text, (income.fecha)::timestamp with time zone)))::date AS first_month
           FROM income
          WHERE (income.fecha >= ((date_trunc('month'::text, now()) - '3 mons'::interval))::date)
          GROUP BY income.client_id, income.client_name
        ), months AS (
         SELECT (generate_series((((date_trunc('month'::text, now()) - '2 mons'::interval))::date)::timestamp with time zone, ((date_trunc('month'::text, now()))::date)::timestamp with time zone, '1 mon'::interval))::date AS month
        )
 SELECT (((r.client_id)::text || '-'::text) || to_char((m.month)::timestamp with time zone, 'YYYYMM'::text)) AS id,
    'gpk'::text AS business,
    (r.client_id)::text AS client_id,
    r.client_name,
    (('Abono '::text || gpk_month_name(m.month)) ||
        CASE
            WHEN (r.moneda <> 'ARS'::text) THEN ((' ('::text || r.moneda) || ')'::text)
            ELSE ''::text
        END) AS concept,
    r.amount,
    r.account_name,
    m.month AS issued_at,
    ((m.month + '9 days'::interval))::date AS due_date,
    ( SELECT min(i.fecha) AS min
           FROM income i
          WHERE ((i.client_id = r.client_id) AND (NOT i.pendiente) AND (i.fecha >= m.month) AND (i.fecha < ((m.month + '1 mon'::interval))::date))) AS paid_at
   FROM (recurring r
     CROSS JOIN months m)
  WHERE (m.month >= r.first_month);
