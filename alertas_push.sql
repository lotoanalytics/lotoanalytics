-- LotoAnalytics · Avisos con la app cerrada
-- Pegar completo en Supabase > SQL Editor > New query > Run.
-- Crea UNA tabla nueva y dos funciones. No toca la tabla "sorteos" ni nada existente.

create table if not exists public.alertas_push (
  id            text primary key,
  endpoint      text not null,
  p256dh        text not null,
  auth          text not null,
  loteria       text not null,
  juego         text not null,
  posicion      text not null default 'cualquiera',
  numeros       jsonb not null,
  esperados     int  not null default 0,
  con_posicion  boolean not null default false,
  creado        timestamptz not null default now(),
  avisados      jsonb not null default '{}'::jsonb
);

create index if not exists alertas_push_juego_idx on public.alertas_push (loteria, juego);

-- Nadie de afuera puede leer ni cambiar la tabla directamente (solo el robot,
-- que usa la llave de servicio). La app solo puede guardar o borrar SUS alertas
-- a través de las dos funciones de abajo.
alter table public.alertas_push enable row level security;

create or replace function public.guardar_alerta_push(
  p_id text, p_endpoint text, p_p256dh text, p_auth text,
  p_loteria text, p_juego text, p_posicion text, p_numeros jsonb,
  p_esperados int, p_con_posicion boolean, p_creado timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_id is null or length(p_id) > 64 or p_endpoint is null or length(p_endpoint) > 1000
     or jsonb_typeof(p_numeros) <> 'array' or jsonb_array_length(p_numeros) > 40 then
    raise exception 'datos no validos';
  end if;
  insert into public.alertas_push (id, endpoint, p256dh, auth, loteria, juego, posicion, numeros, esperados, con_posicion, creado)
  values (p_id, p_endpoint, p_p256dh, p_auth, p_loteria, p_juego, coalesce(p_posicion, 'cualquiera'), p_numeros,
          coalesce(p_esperados, 0), coalesce(p_con_posicion, false), coalesce(p_creado, now()))
  on conflict (id) do update set
    endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
    loteria = excluded.loteria, juego = excluded.juego, posicion = excluded.posicion,
    numeros = excluded.numeros, esperados = excluded.esperados, con_posicion = excluded.con_posicion;
end $$;

create or replace function public.borrar_alerta_push(p_id text) returns void
language sql security definer set search_path = public as $$
  delete from public.alertas_push where id = p_id;
$$;

grant execute on function public.guardar_alerta_push(text, text, text, text, text, text, text, jsonb, int, boolean, timestamptz) to anon, authenticated;
grant execute on function public.borrar_alerta_push(text) to anon, authenticated;
