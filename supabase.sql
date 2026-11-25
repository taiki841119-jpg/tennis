-- テニス乱数表: Supabase 用セットアップ SQL
-- Supabase ダッシュボード > SQL Editor に貼り付けて Run してください。
--
-- 仕組み: テーブルには直接アクセスさせず(RLS有効・ポリシー無し)、
--         「グループ名+合言葉」を渡す関数経由でのみ読み書きできるようにします。

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.groups (
  name       text primary key,
  pass_hash  text not null,
  data       jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.groups enable row level security;
-- ポリシーを作らない = anon キーでは表を直接読み書きできない

create or replace function public.create_group(p_name text, p_pass text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(trim(p_name)) = 0 or length(p_pass) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if exists (select 1 from groups where name = p_name) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;
  insert into groups(name, pass_hash, data) values (p_name, crypt(p_pass, gen_salt('bf')), p_data);
  return jsonb_build_object('ok', true, 'data', p_data, 'version', 1);
end $$;

create or replace function public.get_group(p_name text, p_pass text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g groups;
begin
  select * into g from groups where name = p_name;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if g.pass_hash <> crypt(p_pass, g.pass_hash) then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  return jsonb_build_object('ok', true, 'data', g.data, 'version', g.version);
end $$;

-- 楽観的ロック: version が一致するときだけ保存。ずれていたら最新を返す(同時操作対策)
create or replace function public.save_group(p_name text, p_pass text, p_data jsonb, p_version integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g groups;
begin
  select * into g from groups where name = p_name for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if g.pass_hash <> crypt(p_pass, g.pass_hash) then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  if g.version <> p_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'data', g.data, 'version', g.version);
  end if;
  update groups set data = p_data, version = g.version + 1, updated_at = now() where name = p_name;
  return jsonb_build_object('ok', true, 'version', g.version + 1);
end $$;

grant execute on function public.create_group(text, text, jsonb) to anon;
grant execute on function public.get_group(text, text) to anon;
grant execute on function public.save_group(text, text, jsonb, integer) to anon;
