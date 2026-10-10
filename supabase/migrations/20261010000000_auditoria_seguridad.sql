-- Arreglos de la auditoría de octubre de 2026 (ver docs/AUDITORIA-2026-10.md).
-- Se puede correr más de una vez.

-- 1. PLAN PREMIUM. Cualquier usuario logueado podía hacerse premium desde la consola
--    del navegador: la política de user_profiles le dejaba editar su propia fila, con
--    las columnas plan, is_legacy y premium_hasta incluidas. La app solo crea el perfil
--    vacío (Onboarding: upsert de { id } sin pisar); el plan lo escriben únicamente las
--    funciones del servidor (Mercado Pago), que usan la service role y no pasan por acá.
revoke insert, update, delete on public.user_profiles from anon, authenticated;
grant insert (id) on public.user_profiles to authenticated;

-- 2. CATEGORÍAS. Solo había política de lectura: crear, renombrar, cambiar el tipo o
--    borrar una categoría propia fallaba siempre (Configuración y la categoría
--    Mascotas del onboarding). Las del sistema siguen sin poder tocarse. (Se crean
--    solo si no existen, en vez de borrarlas y recrearlas, para poder correr esto
--    más de una vez sin un DROP.)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'cada uno crea sus categorías') then
    create policy "cada uno crea sus categorías" on public.categories
      for insert to authenticated
      with check (user_id = (select auth.uid()) and not coalesce(es_sistema, false));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'cada uno edita sus categorías') then
    create policy "cada uno edita sus categorías" on public.categories
      for update to authenticated
      using (user_id = (select auth.uid()) and not coalesce(es_sistema, false))
      with check (user_id = (select auth.uid()) and not coalesce(es_sistema, false));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'cada uno borra sus categorías') then
    create policy "cada uno borra sus categorías" on public.categories
      for delete to authenticated
      using (user_id = (select auth.uid()) and not coalesce(es_sistema, false));
  end if;
end $$;

-- 3. COTIZACIONES. Son de todos, y cualquier usuario podía cambiar cualquiera (las 121,
--    de cualquier mes y tipo). La app solo guarda la del euro del mes en curso
--    (fetchDolarRates en el Dashboard): eso es lo único que queda permitido, con un
--    valor razonable. El mes se acepta con un día de margen por las zonas horarias.
alter policy "auth insert exchange_rates" on public.exchange_rates
  with check (
    tipo = 'euro' and valor between 100 and 100000
    and periodo in (to_char(now() - interval '1 day', 'YYYY-MM'), to_char(now() + interval '1 day', 'YYYY-MM'))
  );
alter policy "auth update exchange_rates" on public.exchange_rates
  using (tipo = 'euro' and periodo in (to_char(now() - interval '1 day', 'YYYY-MM'), to_char(now() + interval '1 day', 'YYYY-MM')))
  with check (
    tipo = 'euro' and valor between 100 and 100000
    and periodo in (to_char(now() - interval '1 day', 'YYYY-MM'), to_char(now() + interval '1 day', 'YYYY-MM'))
  );

-- 4. FUNCIONES. Eran ejecutables por cualquiera desde /rest/v1/rpc, sin login. La
--    peligrosa es consume_rate_limit: permitía agotarle el límite a otro usuario o
--    llenar la tabla rate_limits. La usan solo los endpoints, con la service role. Las
--    otras tres son de triggers, que se disparan igual sin este permiso.
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
revoke execute on function public.enforce_account_limit() from public, anon, authenticated;
revoke execute on function public.notify_new_signup() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter function public.consume_rate_limit(text, integer, integer) set search_path = public;
alter function public.enforce_account_limit() set search_path = public;
alter function public.gpk_month_name(date) set search_path = public;

-- 5. AVISO DE REGISTRO. Mandaba la fila entera de auth.users (con el hash de la
--    contraseña y los tokens de confirmación) al endpoint del aviso, que solo usa el
--    mail, el nombre y la fecha: ahora manda solo eso. El secreto del header pasa al
--    Vault de Supabase (sale de la versión anterior de la función la primera vez que
--    se corre esto), así no queda escrito en el código. Y si el aviso falla, el alta
--    sigue igual: nunca puede trabar un registro.
select vault.create_secret(
  substring(pg_get_functiondef('public.notify_new_signup()'::regprocedure) from '''Authorization'', ''(Bearer [^'']+)'''),
  'notify_signup_auth',
  'Header Authorization del aviso de registro (api/notify-signup.js, SUPABASE_WEBHOOK_SECRET)'
)
where not exists (select 1 from vault.secrets where name = 'notify_signup_auth')
  and substring(pg_get_functiondef('public.notify_new_signup()'::regprocedure) from '''Authorization'', ''(Bearer [^'']+)''') is not null;

create or replace function public.notify_new_signup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth text;
begin
  select decrypted_secret into v_auth from vault.decrypted_secrets where name = 'notify_signup_auth';
  if v_auth is null then
    raise log 'notify_new_signup: falta el secreto notify_signup_auth en el Vault';
    return new;
  end if;
  begin
    perform net.http_post(
      url := 'https://momsassist-f.com/api/notify-signup',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_auth),
      body := jsonb_build_object('record', jsonb_build_object(
        'id', new.id,
        'email', new.email,
        'created_at', new.created_at,
        'raw_user_meta_data', jsonb_build_object('full_name', new.raw_user_meta_data->>'full_name')
      ))
    );
  exception when others then
    raise log 'notify_new_signup: no se pudo mandar el aviso: %', sqlerrm;
  end;
  return new;
end;
$function$;

revoke execute on function public.notify_new_signup() from public, anon, authenticated;

-- 6. ÍNDICES para lo que la app filtra siempre (advisor de performance de Supabase).
create index if not exists transactions_user_fecha_idx on public.transactions (user_id, fecha);
create index if not exists transactions_account_fecha_idx on public.transactions (account_id, fecha);
create index if not exists transactions_statement_idx on public.transactions (statement_id);
create index if not exists statements_account_idx on public.statements (account_id);
create index if not exists accounts_user_idx on public.accounts (user_id);
