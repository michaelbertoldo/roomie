-- Roomie schema. Money is stored as integer cents. All ids are uuids.
-- Every house-owned table carries house_id so row-level security stays simple.

create table public.profiles (
  id uuid primary key,                      -- = Neon Auth user id
  first_name text not null default '',
  last_name text not null default '',
  nickname text not null default '',
  email text,
  phone text not null default '',
  location text not null default '',
  allergies text not null default '',
  color text not null default '#4338ca',
  photo_url text,
  venmo text not null default '',
  zelle text not null default '',
  apple_pay text not null default '',
  pay_pref text not null default '' check (pay_pref in ('', 'Venmo', 'Zelle', 'Apple Pay')),
  created_at timestamptz not null default now()
);

create table public.houses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  color text not null default 'indigo',
  address text not null default '',
  currency text not null default 'USD' check (currency in ('USD', 'EUR', 'GBP', 'CAD')),
  home_type text not null default 'Apartment' check (home_type in ('Apartment', 'House', 'Dorm', 'Townhouse')),
  invite_code text not null unique,
  cal_name text not null default 'House Calendar',
  landlord text not null default '',
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  can_manage boolean not null default false,
  widgets jsonb not null default '[{"id":"events","on":true},{"id":"chores","on":true},{"id":"owe","on":true},{"id":"rent","on":true},{"id":"buy","on":true},{"id":"featured","on":true},{"id":"upcomingpay","on":false},{"id":"important","on":false}]',
  joined_at timestamptz not null default now(),
  primary key (house_id, user_id)
);
create index on public.memberships (user_id);
-- exactly one owner per house
create unique index memberships_one_owner on public.memberships (house_id) where role = 'owner';

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  assignee uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  kind text not null default 'one-time' check (kind in ('recurring', 'one-time')),
  days smallint[] not null default '{}',          -- 0 = Sunday
  due_time time,
  due_date date,
  effort text not null default 'easy' check (effort in ('easy', 'medium', 'hard')),
  notes text not null default '',
  status text not null default 'pending' check (status in ('pending', 'done', 'overdue')),
  last_done date,
  rotate boolean not null default false,
  rotation uuid[] not null default '{}',
  show_on_calendar boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.chores (house_id, due_date);
create index on public.chores (assignee);

create table public.chore_swaps (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  chore_id uuid not null references public.chores(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_chore_id uuid references public.chores(id) on delete cascade,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);
create index on public.chore_swaps (house_id);

create table public.chore_skips (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  chore_id uuid not null references public.chores(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined')),
  created_at timestamptz not null default now()
);
create index on public.chore_skips (house_id);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  item text not null check (char_length(item) between 1 and 120),
  total_cents integer not null check (total_cents > 0),
  buyer uuid not null references public.profiles(id),
  purchased_on date not null default current_date,
  method text not null default '',
  created_at timestamptz not null default now()
);
create index on public.purchases (house_id, purchased_on desc);

create table public.purchase_shares (
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'claimed', 'paid')),
  paid_on date,
  primary key (purchase_id, user_id)
);
create index on public.purchase_shares (house_id);
create index on public.purchase_shares (user_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  event_date date not null,
  event_time time,
  category text not null default 'other',
  description text not null default '',
  link text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  featured boolean not null default false,
  host_guests integer check (host_guests is null or host_guests > 0),
  host_from time,
  host_to time,
  created_at timestamptz not null default now()
);
create index on public.events (house_id, event_date);

create table public.event_responses (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  response text check (response in ('agree', 'no')),
  note text not null default '',
  primary key (event_id, user_id)
);

create table public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  note_date date not null,
  body text not null check (char_length(body) between 1 and 300),
  urgent boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null
);
create index on public.calendar_notes (house_id, note_date);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.posts (house_id, created_at desc);

create table public.post_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index on public.post_replies (post_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  actor uuid references public.profiles(id) on delete set null,
  grp text not null default 'General',            -- Chores, Money, Board, Events & Hosting
  kind text not null default 'info' check (kind in ('info', 'swap', 'host', 'claim', 'deleted')),
  body text not null,                              -- plain text, never HTML
  ref text,
  route text,
  unread boolean not null default true,
  dismissed boolean not null default false,
  home_cleared boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications (recipient, created_at desc);

create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  kind text not null check (kind in ('need', 'want')),
  name text not null check (char_length(name) between 1 and 120),
  est_cents integer not null default 0 check (est_cents >= 0),
  claimed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.wishlist_items (house_id);

create table public.wishlist_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table public.rent (
  house_id uuid primary key references public.houses(id) on delete cascade,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  due_date date,
  remind boolean not null default true
);

create table public.rent_payments (
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period date not null,                            -- first day of the rent month
  paid boolean not null default false,
  primary key (house_id, user_id, period)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  owner uuid references public.profiles(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  due_date date
);
create index on public.subscriptions (house_id);
