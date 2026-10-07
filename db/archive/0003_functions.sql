-- Membership operations that must not be done with plain table writes.

-- Call once after every sign-in. Creates the profile row (there is no signup trigger on Neon Auth).
create function public.ensure_profile(p_first text default '', p_last text default '', p_email text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare me uuid := public.current_uid(); r public.profiles;
begin
  if me is null then raise exception 'not signed in'; end if;
  insert into public.profiles (id, email, first_name, last_name)
  values (me, p_email, coalesce(p_first, ''), coalesce(p_last, ''))
  on conflict (id) do update set email = coalesce(excluded.email, public.profiles.email)
  returning * into r;
  return r;
end $$;

create function public.new_invite_code() returns text
language plpgsql volatile as $$
declare c text;
begin
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5)) || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.houses where invite_code = c);
  end loop;
  return c;
end $$;

create function public.create_house(p_name text, p_address text default '', p_type text default 'Apartment')
returns public.houses
language plpgsql security definer set search_path = public as $$
declare h public.houses;
begin
  if (select public.current_uid()) is null then raise exception 'not signed in'; end if;
  insert into public.profiles (id) values ((select public.current_uid())) on conflict do nothing;
  insert into public.houses (name, address, home_type, invite_code, cal_name, owner_id)
  values (trim(p_name), coalesce(p_address, ''), coalesce(p_type, 'Apartment'), public.new_invite_code(), trim(p_name) || ' Calendar', (select public.current_uid()))
  returning * into h;
  insert into public.memberships (house_id, user_id, role, can_manage) values (h.id, (select public.current_uid()), 'owner', true);
  insert into public.rent (house_id) values (h.id);
  return h;
end $$;

-- Joins by invite code. Max 9 members per house.
create function public.join_house(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if (select public.current_uid()) is null then raise exception 'not signed in'; end if;
  insert into public.profiles (id) values ((select public.current_uid())) on conflict do nothing;
  select id into hid from public.houses where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'invalid invite code'; end if;
  if (select count(*) from public.memberships where house_id = hid) >= 9
     and not exists (select 1 from public.memberships where house_id = hid and user_id = (select public.current_uid())) then
    raise exception 'this house is full';
  end if;
  insert into public.memberships (house_id, user_id) values (hid, (select public.current_uid())) on conflict do nothing;
  return hid;
end $$;

-- Owners must transfer ownership before leaving unless they are the last member.
create function public.leave_house(p_house uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from public.memberships where house_id = p_house and user_id = (select public.current_uid());
  if r is null then raise exception 'not a member'; end if;
  if r = 'owner' and (select count(*) from public.memberships where house_id = p_house) > 1 then
    raise exception 'transfer ownership before leaving';
  end if;
  delete from public.memberships where house_id = p_house and user_id = (select public.current_uid());
  if not exists (select 1 from public.memberships where house_id = p_house) then
    delete from public.houses where id = p_house;
  end if;
end $$;

create function public.remove_member(p_house uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner(p_house)
          or exists (select 1 from public.memberships where house_id = p_house and user_id = (select public.current_uid()) and can_manage)) then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.memberships where house_id = p_house and user_id = p_user and role = 'owner') then
    raise exception 'cannot remove the owner';
  end if;
  delete from public.memberships where house_id = p_house and user_id = p_user;
end $$;

create function public.transfer_ownership(p_house uuid, p_new_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner(p_house) then raise exception 'only the owner can transfer ownership'; end if;
  if not exists (select 1 from public.memberships where house_id = p_house and user_id = p_new_owner) then
    raise exception 'new owner must be a member';
  end if;
  update public.memberships set role = 'member' where house_id = p_house and role = 'owner';
  update public.memberships set role = 'owner', can_manage = true where house_id = p_house and user_id = p_new_owner;
  update public.houses set owner_id = p_new_owner where id = p_house;
end $$;

create function public.set_can_manage(p_house uuid, p_user uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner(p_house) then raise exception 'only the owner can change this'; end if;
  update public.memberships set can_manage = p_value where house_id = p_house and user_id = p_user and role <> 'owner';
end $$;

revoke execute on function public.ensure_profile(text, text, text), public.new_invite_code(), public.create_house(text, text, text), public.join_house(text),
  public.leave_house(uuid), public.remove_member(uuid, uuid), public.transfer_ownership(uuid, uuid),
  public.set_can_manage(uuid, uuid, boolean) from public;
grant execute on function public.ensure_profile(text, text, text), public.create_house(text, text, text), public.join_house(text), public.leave_house(uuid),
  public.remove_member(uuid, uuid), public.transfer_ownership(uuid, uuid), public.set_can_manage(uuid, uuid, boolean) to authenticated;
