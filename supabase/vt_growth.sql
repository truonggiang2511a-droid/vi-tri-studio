-- Vị Trí Studio — lưu căn nhà theo tài khoản, đếm lượt vào trang, nguồn khách, phễu cho trang quản trị.
-- Chạy lại nhiều lần vẫn an toàn.

-- ---------- Căn nhà đã lưu ----------
create table if not exists public.vt_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.vt_users (id) on delete cascade,
  name text not null default '',
  sub text not null default '',
  lat double precision,
  lng double precision,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists vt_projects_user_idx on public.vt_projects (user_id, updated_at desc);

-- ---------- Lượt vào trang (gộp theo ngày, trang, nguồn; không lưu thông tin cá nhân) ----------
create table if not exists public.vt_visits (
  day date not null,
  page text not null,
  source text not null,
  n int not null default 0,
  primary key (day, page, source)
);

alter table public.vt_users add column if not exists source text;

alter table public.vt_projects enable row level security;
alter table public.vt_visits enable row level security;
revoke all on table public.vt_projects, public.vt_visits from anon, authenticated;

create or replace function public.vt__day() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace function public.vt__src(p text) returns text
language sql immutable as $$
  select coalesce(nullif(left(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9_.-]', '', 'g'), 24), ''), 'truc-tiep')
$$;

-- ---------- Hàm cho khách ----------
create or replace function public.vt_visit(p_page text, p_source text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_page not in ('landing', 'app') then return; end if;
  insert into vt_visits (day, page, source, n) values (vt__day(), p_page, vt__src(p_source), 1)
  on conflict (day, page, source) do update set n = vt_visits.n + 1;
end $$;

-- Ghi nguồn khách lúc đăng ký (chỉ ghi lần đầu)
create or replace function public.vt_set_source(p_token text, p_source text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  update vt_users set source = vt__src(p_source) where id = u.id and source is null;
end $$;

create or replace function public.vt_project_save(p_token text, p_id uuid, p_name text, p_sub text, p_lat double precision, p_lng double precision, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_projects; n int;
begin
  u := vt__user(p_token);
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform vt__err('Dữ liệu căn nhà không hợp lệ', 'INPUT'); end if;
  if pg_column_size(p_data) > 400000 then perform vt__err('Căn này quá nhiều dữ liệu để lưu, bỏ bớt tiện ích rồi thử lại', 'INPUT'); end if;
  if p_id is not null then
    update vt_projects set name = left(btrim(coalesce(p_name, '')), 80), sub = left(btrim(coalesce(p_sub, '')), 120),
      lat = p_lat, lng = p_lng, data = p_data, updated_at = now()
    where id = p_id and user_id = u.id and not deleted returning * into pr;
    if found then return jsonb_build_object('id', pr.id, 'updated_at', pr.updated_at); end if;
  end if;
  select count(*) into n from vt_projects where user_id = u.id and not deleted;
  if n >= 300 then perform vt__err('Đã lưu tối đa 300 căn. Xoá bớt căn cũ rồi lưu lại.', 'LIMIT'); end if;
  insert into vt_projects (user_id, name, sub, lat, lng, data)
  values (u.id, left(btrim(coalesce(p_name, '')), 80), left(btrim(coalesce(p_sub, '')), 120), p_lat, p_lng, p_data)
  returning * into pr;
  return jsonb_build_object('id', pr.id, 'updated_at', pr.updated_at);
end $$;

create or replace function public.vt_project_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sub', sub, 'lat', lat, 'lng', lng,
      'updated_at', updated_at, 'created_at', created_at) order by updated_at desc)
    from (select * from vt_projects where user_id = u.id and not deleted order by updated_at desc limit 300) t), '[]'::jsonb);
end $$;

create or replace function public.vt_project_get(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_projects;
begin
  u := vt__user(p_token);
  select * into pr from vt_projects where id = p_id and user_id = u.id and not deleted;
  if not found then perform vt__err('Không tìm thấy căn này', 'INPUT'); end if;
  return jsonb_build_object('id', pr.id, 'name', pr.name, 'data', pr.data, 'updated_at', pr.updated_at);
end $$;

create or replace function public.vt_project_delete(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  -- Xoá mềm: bỏ dữ liệu, ẩn khỏi danh sách
  update vt_projects set deleted = true, data = '{}'::jsonb, updated_at = now() where id = p_id and user_id = u.id;
  return '{"ok":true}'::jsonb;
end $$;

-- ---------- Quản trị: phễu khách hàng ----------
create or replace function public.vt_admin_funnel(p_key text, p_days int default 30) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d int := greatest(1, least(coalesce(p_days, 30), 365)); since timestamptz; since_day date;
begin
  perform vt__admin(p_key);
  since_day := vt__day() - (d - 1);
  since := since_day::timestamp at time zone 'Asia/Ho_Chi_Minh';
  return jsonb_build_object(
    'days', d,
    'visits_landing', (select coalesce(sum(n), 0) from vt_visits where page = 'landing' and day >= since_day),
    'visits_app', (select coalesce(sum(n), 0) from vt_visits where page = 'app' and day >= since_day),
    'visit_sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'landing', l, 'app', a) order by l + a desc) from (
        select source, coalesce(sum(n) filter (where page = 'landing'), 0) as l, coalesce(sum(n) filter (where page = 'app'), 0) as a
        from vt_visits where day >= since_day group by source) v), '[]'::jsonb),
    'signups', (select count(*) from vt_users where created_at >= since),
    'exported', (select count(*) from vt_users u where u.created_at >= since
      and exists (select 1 from vt_usage g where g.user_id = u.id and g.kind = 'export')),
    'paid', (select count(*) from vt_users u where u.created_at >= since
      and exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid')),
    'ref_signups', (select count(*) from vt_users where created_at >= since and referred_by is not null),
    'orders_paid', (select count(*) from vt_orders where status = 'paid' and paid_at >= since),
    'revenue', (select coalesce(sum(coalesce(paid_amount, amount)), 0) from vt_orders where status = 'paid' and paid_at >= since),
    'by_source', coalesce((select jsonb_agg(x order by (x->>'signups')::int desc) from (
        select jsonb_build_object('source', coalesce(u.source, 'khong-ro'), 'signups', count(*),
          'exported', count(*) filter (where exists (select 1 from vt_usage g where g.user_id = u.id and g.kind = 'export')),
          'paid', count(*) filter (where exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid'))) as x
        from vt_users u where u.created_at >= since group by coalesce(u.source, 'khong-ro')) t), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', g.day,
        'visits', (select coalesce(sum(n), 0) from vt_visits v where v.day = g.day),
        'signups', (select count(*) from vt_users u where (u.created_at at time zone 'Asia/Ho_Chi_Minh')::date = g.day),
        'exports', (select count(*) from vt_usage x where x.kind = 'export' and (x.created_at at time zone 'Asia/Ho_Chi_Minh')::date = g.day),
        'paid', (select count(*) from vt_orders o where o.status = 'paid' and (o.paid_at at time zone 'Asia/Ho_Chi_Minh')::date = g.day)
      ) order by g.day desc)
      from (select generate_series(since_day, vt__day(), interval '1 day')::date as day) g), '[]'::jsonb));
end $$;

-- Khách đã dùng hết lượt (hoặc còn ≤ 1) nhưng chưa từng mua: danh sách để nhắn chăm sóc
create or replace function public.vt_admin_followups(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  return coalesce((select jsonb_agg(x order by x->>'last_export' desc nulls last) from (
    select jsonb_build_object('id', u.id, 'login', u.login, 'name', u.name, 'credits', u.credits, 'source', u.source,
      'created_at', u.created_at, 'note', u.note,
      'exports', (select count(*) from vt_usage g where g.user_id = u.id and g.kind = 'export'),
      'last_export', (select max(created_at) from vt_usage g where g.user_id = u.id and g.kind = 'export')) as x
    from vt_users u
    where u.status = 'active' and u.credits <= 1 and coalesce(u.unlimited_until < now(), true)
      and not exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid')
      and exists (select 1 from vt_usage g where g.user_id = u.id and g.kind = 'export')
      and u.created_at > now() - interval '90 days'
    order by u.created_at desc limit 200) t), '[]'::jsonb);
end $$;

-- ---------- Quyền gọi hàm ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'vt\_%' loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like 'vt\_\_%' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
