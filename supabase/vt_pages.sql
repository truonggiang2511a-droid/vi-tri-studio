-- Vị Trí Studio — Trang web riêng cho từng căn + sổ khách tiềm năng (CRM mini) + thông báo Telegram.
-- Ảnh lưu ở Storage bucket vt-pages (đọc công khai, ghi bằng vé tải lên 15 phút do vt_page_upload cấp).

create table if not exists public.vt_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.vt_users(id),
  slug text not null unique,
  title text not null default '',
  price text not null default '', area text not null default '', beds text not null default '', legal text not null default '',
  address text not null default '', description text not null default '',
  lat double precision, lng double precision,
  phone text not null default '', brand text not null default '', style text not null default 'neon',
  video_url text not null default '',
  photos text[] not null default '{}',
  pois jsonb not null default '[]', roads jsonb not null default '[]',
  status text not null default 'live' check (status in ('live', 'hidden', 'deleted')),
  views int not null default 0, calls int not null default 0, zalos int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists vt_pages_user_idx on public.vt_pages (user_id, updated_at desc);

create table if not exists public.vt_leads (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references public.vt_pages(id),
  user_id uuid not null references public.vt_users(id),
  name text not null default '', phone text not null, want text not null default '', note text not null default '',
  status text not null default 'moi' check (status in ('moi', 'da_lien_he', 'hen_xem', 'dam_phan', 'chot', 'khong_mua')),
  ip text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists vt_leads_user_idx on public.vt_leads (user_id, created_at desc);

create table if not exists public.vt_upload_tickets (
  path text primary key, user_id uuid not null, expires_at timestamptz not null
);
create table if not exists public.vt_tg_codes (
  code text primary key, user_id uuid not null, expires_at timestamptz not null
);
alter table public.vt_users add column if not exists tg_chat text;
alter table public.vt_users add column if not exists tg_name text;

alter table public.vt_pages enable row level security;
alter table public.vt_leads enable row level security;
alter table public.vt_upload_tickets enable row level security;
alter table public.vt_tg_codes enable row level security;
revoke all on public.vt_pages, public.vt_leads, public.vt_upload_tickets, public.vt_tg_codes from anon, authenticated;

-- Bucket ảnh
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vt-pages', 'vt-pages', true, 3145728, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/webp'];

create or replace function public.vt__ticket_ok(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vt_upload_tickets where path = p_path and expires_at > now());
$$;
revoke all on function public.vt__ticket_ok(text) from public;
grant execute on function public.vt__ticket_ok(text) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vt-pages upload by ticket') then
    create policy "vt-pages upload by ticket" on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'vt-pages' and public.vt__ticket_ok(name));
  end if;
end $$;

create or replace function public.vt__slug() returns text language plpgsql set search_path = public as $$
declare s text; a text := 'abcdefghjkmnpqrstuvwxyz23456789';
begin
  loop
    s := '';
    for i in 1..7 loop s := s || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists (select 1 from vt_pages where slug = s);
  end loop;
  return s;
end $$;

create or replace function public.vt__page_json(p vt_pages) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'price', p.price, 'area', p.area, 'beds', p.beds,
    'legal', p.legal, 'address', p.address, 'description', p.description, 'lat', p.lat, 'lng', p.lng, 'phone', p.phone,
    'brand', p.brand, 'style', p.style, 'video_url', p.video_url, 'photos', to_jsonb(p.photos), 'pois', p.pois, 'roads', p.roads,
    'status', p.status, 'views', p.views, 'calls', p.calls, 'zalos', p.zalos, 'created_at', p.created_at, 'updated_at', p.updated_at);
$$;

-- Cấp vé tải ảnh (tối đa 8 ảnh/lần)
create or replace function public.vt_page_upload(p_token text, p_count int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; v_out text[] := '{}'; pth text; n int := least(8, greatest(1, coalesce(p_count, 1)));
begin
  u := vt__user(p_token);
  if (select count(*) from vt_upload_tickets where user_id = u.id and expires_at > now() - interval '1 hour') > 120 then
    perform vt__err('Tải ảnh quá nhiều, thử lại sau ít phút', 'LIMIT');
  end if;
  for i in 1..n loop
    pth := 'p/' || replace(u.id::text, '-', '') || '/' || encode(extensions.gen_random_bytes(9), 'hex') || '.jpg';
    insert into vt_upload_tickets (path, user_id, expires_at) values (pth, u.id, now() + interval '15 minutes');
    v_out := v_out || pth;
  end loop;
  return to_jsonb(v_out);
end $$;

create or replace function public.vt_page_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; r vt_pages; pid uuid := nullif(p->>'id', '')::uuid; ph text[]; prefix text;
  t text := left(btrim(coalesce(p->>'title', '')), 120);
begin
  u := vt__user(p_token);
  prefix := 'p/' || replace(u.id::text, '-', '') || '/';
  -- Chỉ nhận ảnh nằm trong thư mục của chính tài khoản này
  select coalesce(array_agg(x), '{}') into ph from (
    select x from jsonb_array_elements_text(coalesce(p->'photos', '[]')) x where x like prefix || '%' and x ~ '^[a-z0-9/._-]+$' limit 8) s;
  if pid is not null then
    select * into r from vt_pages where id = pid and user_id = u.id;
    if not found or r.status = 'deleted' then perform vt__err('Không tìm thấy trang này', 'INPUT'); end if;
  else
    if (select count(*) from vt_pages where user_id = u.id and status <> 'deleted') >= 200 then
      perform vt__err('Tối đa 200 trang. Xoá bớt trang cũ để tạo trang mới.', 'LIMIT');
    end if;
    insert into vt_pages (user_id, slug) values (u.id, vt__slug()) returning * into r;
  end if;
  update vt_pages set
    title = t, price = left(coalesce(p->>'price', ''), 40), area = left(coalesce(p->>'area', ''), 40),
    beds = left(coalesce(p->>'beds', ''), 30), legal = left(coalesce(p->>'legal', ''), 40),
    address = left(coalesce(p->>'address', ''), 160), description = left(coalesce(p->>'description', ''), 2000),
    lat = (p->>'lat')::double precision, lng = (p->>'lng')::double precision,
    phone = left(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), 15), brand = left(coalesce(p->>'brand', ''), 80),
    style = left(coalesce(p->>'style', 'neon'), 20),
    video_url = case when coalesce(p->>'video_url', '') ~* '^https://([a-z0-9-]+\.)*(youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch)/' then left(p->>'video_url', 400) else '' end,
    photos = ph,
    pois = case when jsonb_typeof(p->'pois') = 'array' then (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(p->'pois') e limit 12) s) else '[]' end,
    roads = case when jsonb_typeof(p->'roads') = 'array' then (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(p->'roads') e limit 6) s) else '[]' end,
    status = case when p->>'status' in ('live', 'hidden') then p->>'status' else status end,
    updated_at = now()
  where id = r.id returning * into r;
  return vt__page_json(r);
end $$;

create or replace function public.vt_page_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  return coalesce((select jsonb_agg(vt__page_json(p) || jsonb_build_object(
      'leads', (select count(*) from vt_leads l where l.page_id = p.id)) order by p.updated_at desc)
    from vt_pages p where p.user_id = u.id and p.status <> 'deleted'), '[]'::jsonb);
end $$;

create or replace function public.vt_page_remove(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  update vt_pages set status = 'deleted', updated_at = now() where id = p_id and user_id = u.id;
end $$;

-- Trang công khai (khách xem): không trả về thông tin tài khoản
create or replace function public.vt_page_public(p_slug text, p_count boolean default true) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r vt_pages;
begin
  select * into r from vt_pages where slug = lower(btrim(p_slug)) and status = 'live';
  if not found then return null; end if;
  if p_count then update vt_pages set views = views + 1 where id = r.id; end if;
  return vt__page_json(r) - 'views' - 'calls' - 'zalos' - 'status' - 'id';
end $$;

create or replace function public.vt_page_event(p_slug text, p_kind text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update vt_pages set calls = calls + case when p_kind = 'call' then 1 else 0 end,
    zalos = zalos + case when p_kind = 'zalo' then 1 else 0 end
  where slug = lower(btrim(p_slug)) and p_kind in ('call', 'zalo');
end $$;

-- Khách để lại số điện thoại; trả về chat Telegram của môi giới để máy chủ báo tin
create or replace function public.vt_lead_submit(p_slug text, p_name text, p_phone text, p_want text default '', p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r vt_pages; ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'); v_ip text := vt__ip(); u vt_users; l vt_leads;
begin
  select * into r from vt_pages where slug = lower(btrim(p_slug)) and status = 'live';
  if not found then perform vt__err('Trang không còn hoạt động', 'INPUT'); end if;
  ph := regexp_replace(ph, '^\+?84', '0');
  if ph !~ '^0[35789][0-9]{8}$' then perform vt__err('Số điện thoại chưa đúng, kiểm tra lại giúp em', 'INPUT'); end if;
  if v_ip is not null and (select count(*) from vt_leads x where x.ip = v_ip and x.created_at > now() - interval '1 hour') >= 6 then
    perform vt__err('Đã gửi nhiều lần, môi giới sẽ liên hệ sớm', 'LIMIT');
  end if;
  select * into l from vt_leads where page_id = r.id and phone = ph and created_at > now() - interval '1 day';
  if found then return jsonb_build_object('ok', true, 'dup', true); end if;
  insert into vt_leads (page_id, user_id, name, phone, want, note, ip)
  values (r.id, r.user_id, left(btrim(coalesce(p_name, '')), 60), ph, left(coalesce(p_want, ''), 40), left(coalesce(p_note, ''), 500), v_ip)
  returning * into l;
  select * into u from vt_users where id = r.user_id;
  return jsonb_build_object('ok', true, 'notify', case when u.tg_chat is null then null else jsonb_build_object(
    'chat', u.tg_chat, 'title', r.title, 'price', r.price, 'slug', r.slug, 'name', l.name, 'phone', l.phone, 'want', l.want, 'note', l.note) end);
end $$;

create or replace function public.vt_lead_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'phone', l.phone, 'want', l.want, 'note', l.note,
      'status', l.status, 'created_at', l.created_at, 'page_title', p.title, 'page_slug', p.slug, 'page_price', p.price) order by l.created_at desc)
    from (select * from vt_leads where user_id = u.id order by created_at desc limit 500) l left join vt_pages p on p.id = l.page_id), '[]'::jsonb);
end $$;

create or replace function public.vt_lead_update(p_token text, p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  update vt_leads set status = case when p_status in ('moi', 'da_lien_he', 'hen_xem', 'dam_phan', 'chot', 'khong_mua') then p_status else status end,
    note = coalesce(left(p_note, 500), note), updated_at = now()
  where id = p_id and user_id = u.id;
end $$;

-- Kết nối Telegram: app tạo mã 10 phút -> môi giới mở bot với mã -> máy chủ gọi vt_tg_link
create or replace function public.vt_tg_code(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; c text := encode(extensions.gen_random_bytes(9), 'hex');
begin
  u := vt__user(p_token);
  update vt_tg_codes set expires_at = now() where user_id = u.id and expires_at > now();
  insert into vt_tg_codes values (c, u.id, now() + interval '10 minutes');
  return jsonb_build_object('code', c, 'linked', u.tg_chat is not null, 'tg_name', u.tg_name);
end $$;

create or replace function public.vt_tg_link(p_code text, p_chat text, p_name text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c vt_tg_codes; u vt_users;
begin
  select * into c from vt_tg_codes where code = btrim(p_code) and expires_at > now();
  if not found then return jsonb_build_object('ok', false); end if;
  update vt_tg_codes set expires_at = now() where code = c.code;
  update vt_users set tg_chat = left(p_chat, 30), tg_name = left(coalesce(p_name, ''), 60) where id = c.user_id returning * into u;
  return jsonb_build_object('ok', true, 'name', coalesce(nullif(u.name, ''), u.login));
end $$;

create or replace function public.vt_tg_unlink(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  update vt_users set tg_chat = null, tg_name = null where id = u.id;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('vt__slug', 'vt__page_json') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('vt_page_upload', 'vt_page_save', 'vt_page_list', 'vt_page_remove', 'vt_page_public',
             'vt_page_event', 'vt_lead_submit', 'vt_lead_list', 'vt_lead_update', 'vt_tg_code', 'vt_tg_link', 'vt_tg_unlink') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

-- Bản 2: máy chủ gọi thay khách nên truyền IP thật (p_ip) để giới hạn số lần gửi; thêm giới hạn theo trang
-- (đã chạy: migration vt_lead_submit2_ip). vt_me trả thêm leads_new, tg_linked (migration vt_me_leads_new).

-- Bản 3 (migration vt_cron_reminders_weekly): nhắc gọi lại khách sau 2 giờ, báo cáo tuần, đổi trạng thái khách từ nút Telegram.
-- Khoá máy chủ = TELEGRAM_SECRET, được lưu (dạng băm) khi chủ app bấm "Kết nối bot Telegram" trong trang quản trị.
