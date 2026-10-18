-- Vị Trí Studio — tài khoản khách hàng, lượt dùng thử, gói trả phí, thanh toán VietQR.
-- Mọi bảng khoá kín (RLS bật, không policy, thu hồi quyền); trình duyệt và edge function
-- chỉ gọi được các hàm vt_* bên dưới. Hàm nội bộ có tên vt__* không mở ra ngoài.
create extension if not exists pgcrypto with schema extensions;

-- ---------- Bảng ----------
create table if not exists public.vt_config (
  id int primary key default 1 check (id = 1),
  trial_credits int not null default 3,
  bank_bin text not null default '970422',
  bank_name text not null default 'MB Bank',
  bank_account text not null default '',
  bank_holder text not null default '',
  zalo_url text not null default '',
  support_note text not null default '',
  order_prefix text not null default 'VT',
  tts_daily_chars int not null default 30000,
  unlimited_daily_exports int not null default 30,
  reexport_hours int not null default 24,
  signup_per_ip_day int not null default 3,
  admin_key_hash bytea,
  webhook_key_hash bytea,
  updated_at timestamptz not null default now()
);
insert into public.vt_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.vt_users (
  id uuid primary key default gen_random_uuid(),
  login text not null unique,
  name text not null default '',
  pass_hash text not null,
  credits int not null default 0 check (credits >= 0),
  unlimited_until timestamptz,
  status text not null default 'active' check (status in ('active', 'locked')),
  signup_ip text,
  note text not null default '',
  created_at timestamptz not null default now(),
  last_login timestamptz
);
create index if not exists vt_users_ip_idx on public.vt_users (signup_ip, created_at);

create table if not exists public.vt_sessions (
  token_hash bytea primary key,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days',
  last_seen timestamptz not null default now()
);
create index if not exists vt_sessions_user_idx on public.vt_sessions (user_id);

create table if not exists public.vt_login_fails (
  id bigserial primary key,
  login text not null,
  at timestamptz not null default now()
);
create index if not exists vt_login_fails_idx on public.vt_login_fails (login, at);

create table if not exists public.vt_packages (
  id text primary key,
  name text not null,
  description text not null default '',
  price_vnd int not null check (price_vnd > 0),
  credits int not null default 0 check (credits >= 0),
  days int not null default 0 check (days >= 0),
  active boolean not null default true,
  highlight boolean not null default false,
  sort int not null default 0
);

create table if not exists public.vt_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  package_id text not null references public.vt_packages (id),
  package_name text not null,
  amount int not null,
  credits int not null default 0,
  days int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_amount int,
  paid_ref text,
  paid_via text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists vt_orders_user_idx on public.vt_orders (user_id, created_at desc);
create index if not exists vt_orders_status_idx on public.vt_orders (status, created_at desc);

create table if not exists public.vt_usage (
  id bigserial primary key,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  kind text not null check (kind in ('export', 'tts', 'script', 'grant')),
  credits int not null default 0,
  charged boolean not null default false,
  chars int not null default 0,
  lat double precision,
  lng double precision,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists vt_usage_user_idx on public.vt_usage (user_id, kind, created_at desc);

create table if not exists public.vt_payment_events (
  id bigserial primary key,
  source text not null,
  ref text,
  amount int,
  content text,
  matched_code text,
  result text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists vt_payment_events_ref_idx on public.vt_payment_events (source, ref) where ref is not null;

do $$
declare t text;
begin
  foreach t in array array['vt_config','vt_users','vt_sessions','vt_login_fails','vt_packages','vt_orders','vt_usage','vt_payment_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.vt_login_fails_id_seq, public.vt_usage_id_seq, public.vt_payment_events_id_seq from anon, authenticated;

