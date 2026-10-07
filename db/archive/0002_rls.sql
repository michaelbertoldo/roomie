-- Row-level security for the Neon Data API.
-- Rule of thumb: you can touch a house's rows only if you are a member.
-- Requires the Data API to be enabled first (it creates auth.user_id() and the `authenticated` role).

-- Current user id from the request JWT (Neon Auth user ids are uuids).
-- SECURITY DEFINER because on Neon the `authenticated` role has no access to the auth schema.
create function public.current_uid() returns uuid
language sql stable security definer set search_path = '' as $$ select nullif(auth.user_id(), '')::uuid $$;

create function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where house_id = hid and user_id = (select public.current_uid()));
$$;

create function public.is_owner(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where house_id = hid and user_id = (select public.current_uid()) and role = 'owner');
$$;

create function public.shares_house_with(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.house_id = b.house_id
    where a.user_id = (select public.current_uid()) and b.user_id = uid
  );
$$;

revoke execute on function public.is_member(uuid), public.is_owner(uuid), public.shares_house_with(uuid) from public;
grant execute on function public.is_member(uuid), public.is_owner(uuid), public.shares_house_with(uuid) to authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
grant execute on function public.current_uid() to authenticated;

alter table public.profiles enable row level security;
alter table public.houses enable row level security;
alter table public.memberships enable row level security;
alter table public.chores enable row level security;
alter table public.chore_swaps enable row level security;
alter table public.chore_skips enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_shares enable row level security;
alter table public.events enable row level security;
alter table public.event_responses enable row level security;
alter table public.calendar_notes enable row level security;
alter table public.posts enable row level security;
alter table public.post_replies enable row level security;
alter table public.notifications enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.wishlist_comments enable row level security;
alter table public.rent enable row level security;
alter table public.rent_payments enable row level security;
alter table public.subscriptions enable row level security;

-- profiles: yourself and housemates. Edit only your own.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select public.current_uid()) or public.shares_house_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select public.current_uid())) with check (id = (select public.current_uid()));

-- houses: members read; only the owner edits. Creating goes through create_house().
create policy houses_select on public.houses for select to authenticated using (public.is_member(id));
create policy houses_update on public.houses for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

-- memberships: members see the roster. Own preferences (widgets) editable by the member.
-- Joining, leaving, removing and ownership transfer go through functions.
create policy memberships_select on public.memberships for select to authenticated using (public.is_member(house_id));
create policy memberships_update_self on public.memberships for update to authenticated
  using (user_id = (select public.current_uid())) with check (user_id = (select public.current_uid()) and role = (select role from public.memberships m where m.house_id = memberships.house_id and m.user_id = (select public.current_uid())));

-- Plain "any member can do anything in their house" tables.
do $$
declare t text;
begin
  foreach t in array array['chores','chore_swaps','chore_skips','events','event_responses','calendar_notes',
                           'wishlist_items','wishlist_comments','rent','rent_payments','subscriptions']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(house_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_member(house_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_member(house_id)) with check (public.is_member(house_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_member(house_id))', t || '_delete', t);
  end loop;
end $$;

-- purchases: members read; you can only record purchases you bought; only the buyer edits or deletes.
create policy purchases_select on public.purchases for select to authenticated using (public.is_member(house_id));
create policy purchases_insert on public.purchases for insert to authenticated
  with check (public.is_member(house_id) and buyer = (select public.current_uid()));
create policy purchases_update on public.purchases for update to authenticated
  using (buyer = (select public.current_uid())) with check (buyer = (select public.current_uid()) and public.is_member(house_id));
create policy purchases_delete on public.purchases for delete to authenticated using (buyer = (select public.current_uid()));

-- purchase_shares: buyer creates them. The payer can mark "claimed", the buyer confirms "paid".
create policy shares_select on public.purchase_shares for select to authenticated using (public.is_member(house_id));
create policy shares_insert on public.purchase_shares for insert to authenticated
  with check (public.is_member(house_id) and exists (select 1 from public.purchases p where p.id = purchase_id and p.buyer = (select public.current_uid())));
create policy shares_update on public.purchase_shares for update to authenticated
  using (user_id = (select public.current_uid()) or exists (select 1 from public.purchases p where p.id = purchase_id and p.buyer = (select public.current_uid())))
  with check (
    public.is_member(house_id)
    and (status <> 'paid' or exists (select 1 from public.purchases p where p.id = purchase_id and p.buyer = (select public.current_uid())))
  );
create policy shares_delete on public.purchase_shares for delete to authenticated
  using (exists (select 1 from public.purchases p where p.id = purchase_id and p.buyer = (select public.current_uid())));

-- posts and replies: members read and write; only the author edits or deletes.
create policy posts_select on public.posts for select to authenticated using (public.is_member(house_id));
create policy posts_insert on public.posts for insert to authenticated with check (public.is_member(house_id) and author = (select public.current_uid()));
create policy posts_update on public.posts for update to authenticated using (author = (select public.current_uid())) with check (author = (select public.current_uid()));
create policy posts_delete on public.posts for delete to authenticated using (author = (select public.current_uid()));
create policy replies_select on public.post_replies for select to authenticated using (public.is_member(house_id));
create policy replies_insert on public.post_replies for insert to authenticated with check (public.is_member(house_id) and author = (select public.current_uid()));
create policy replies_delete on public.post_replies for delete to authenticated using (author = (select public.current_uid()));

-- notifications: only the recipient reads or updates. Any member may notify another member of the same house.
create policy notifs_select on public.notifications for select to authenticated using (recipient = (select public.current_uid()));
create policy notifs_update on public.notifications for update to authenticated
  using (recipient = (select public.current_uid())) with check (recipient = (select public.current_uid()));
create policy notifs_insert on public.notifications for insert to authenticated
  with check (public.is_member(house_id) and actor = (select public.current_uid())
              and exists (select 1 from public.memberships m where m.house_id = notifications.house_id and m.user_id = recipient));
