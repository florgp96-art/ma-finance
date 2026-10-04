-- Notas sobre el formato de los resúmenes de cada entidad, aprendidas en las
-- revisiones automáticas de lecturas que no cerraban con el total (ver
-- src/lib/revisionLectura.js y api/_lib/revisarLectura.js).
--
-- Son compartidas entre usuarios y solo describen el formato: nunca datos de
-- quien subió el resumen. Solo las lee y las escribe el servidor con la service
-- role: RLS activado y sin políticas, así ningún cliente puede leerlas ni
-- escribirlas. creado_por es solo para que la dueña de la app pueda rastrear de
-- dónde salió una nota; no se le muestra a nadie.
create table if not exists public.formatos_lectura (
  id uuid primary key default gen_random_uuid(),
  clave text not null,
  entidad text not null,
  producto text,
  tipo_documento text not null default 'tarjeta',
  nota text not null,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists formatos_lectura_clave_idx on public.formatos_lectura (clave, created_at desc);

alter table public.formatos_lectura enable row level security;
