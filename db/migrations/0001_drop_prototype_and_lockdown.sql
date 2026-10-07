-- Removes the first RLS/Data-API prototype and locks the public schema down.
-- Run once, after the Data API was turned off, BEFORE applying db/schema.sql (v3).
-- All /api access uses the table owner role (neondb_owner) over DATABASE_URL.
-- The Data API roles (authenticated, anonymous) must never get privileges on app tables.
BEGIN;

DROP TABLE IF EXISTS
  calendar_notes, chore_skips, chore_swaps, chores, event_responses, events, houses,
  memberships, notifications, post_replies, posts, profiles, purchase_shares, purchases,
  rent, rent_payments, subscriptions, wishlist_comments, wishlist_items
CASCADE;

DROP FUNCTION IF EXISTS
  create_house(text, text, text), current_uid(), ensure_profile(text, text, text),
  is_member(uuid), is_owner(uuid), join_house(text), leave_house(uuid), new_invite_code(),
  remove_member(uuid, uuid), set_can_manage(uuid, uuid, boolean), shares_house_with(uuid),
  transfer_ownership(uuid, uuid);

-- Existing objects
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated, anonymous;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated, anonymous;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated, anonymous;
REVOKE ALL ON SCHEMA public FROM authenticated, anonymous;

-- Future objects created by the owner role
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM authenticated, anonymous;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated, anonymous;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated, anonymous;
-- Functions are executable by PUBLIC by default; authenticated/anonymous would inherit that.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- The schema-scoped line above cannot remove Postgres's global "functions are executable by PUBLIC"
-- default, so also turn that global default off for functions the owner creates from now on.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- v3's set_updated_at() was created after this migration ran, so db/schema.sql must be followed by:
--   REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;   (see db/migrations/0002_lock_set_updated_at.sql)

COMMIT;
