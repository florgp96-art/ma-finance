-- Memoria del mail de auditoría de los viernes (api/cron-auditoria.js y
-- api/_lib/hallazgosAuditoria.js): qué hallazgos ya se avisaron, para mandar solo
-- lo nuevo en vez de la misma lista todas las semanas. La lee y la escribe solo el
-- cron, con la service role: RLS sin políticas y sin permisos para los usuarios.
-- Se puede correr más de una vez.

create table if not exists public.auditoria_hallazgos (
  clave          text primary key,  -- sha256 de usuario + texto del hallazgo ('__inicio__' marca que ya arrancó)
  user_id        uuid references auth.users(id) on delete cascade,
  texto          text not null,
  visto_primero  timestamptz not null default now(),
  visto_ultimo   timestamptz not null default now()
);

alter table public.auditoria_hallazgos enable row level security;
revoke all on public.auditoria_hallazgos from anon, authenticated;
