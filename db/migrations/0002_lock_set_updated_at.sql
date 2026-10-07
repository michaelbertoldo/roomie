-- v3 created set_updated_at() with Postgres's default EXECUTE-for-PUBLIC.
-- Triggers only need EXECUTE when they are created, so nobody else needs it.
REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;
