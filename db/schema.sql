-- Roommate App schema (IS 401 Team 4-06) — v3
-- Target: PostgreSQL 15+ (Neon). Run once on an empty database.
--
-- v3 changes from v2:
--   * users.auth_provider_id links a row to the sign-in provider (Clerk, Auth.js, ...)
--   * household.timezone: recurring chores, reminders and the calendar use it
--   * household_member.left_date: roommates move out without deleting history
--   * every table has created_at / updated_at; updated_at is maintained by a trigger
--   * expense_share.is_paid replaced by settled_by_payment_id, so "paid back" can
--     never disagree with the payment records

BEGIN;

-- =========================================================
-- Shared trigger: keep updated_at current on every UPDATE
-- =========================================================

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- =========================================================
-- People & Households
-- =========================================================

CREATE TABLE household (
    household_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_name  TEXT NOT NULL,
    address         TEXT,
    join_code       TEXT NOT NULL UNIQUE,
    theme_color     TEXT,
    timezone        TEXT NOT NULL DEFAULT 'America/Denver',  -- IANA name; app validates it
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "user" is a reserved word in Postgres, so the table is named users.
CREATE TABLE users (
    user_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auth_provider_id TEXT UNIQUE,     -- the sign-in provider's id for this person
    first_name       TEXT NOT NULL,
    last_name        TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    phone_number     TEXT,
    profile_photo    TEXT,            -- URL to the stored image
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- left_date IS NULL means the person currently lives there.
-- Rejoining the same household clears left_date on the existing row.
CREATE TABLE household_member (
    member_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id    BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_date       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (household_id, user_id),
    CHECK (left_date IS NULL OR left_date >= joined_date)
);

CREATE TABLE payment_method (
    payment_method_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    app             TEXT NOT NULL CHECK (app IN ('venmo', 'zelle', 'apple_cash')),
    username        TEXT NOT NULL,
    is_preferred    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Chores
-- =========================================================

-- The rule: what the chore is and how often it happens.
-- Times are in the household's timezone.
-- repeats = 'none'    -> one-time: start_date + due_time
-- repeats = 'weekly'  -> every week on day_of_week (0 = Sunday) at due_time
-- repeats = 'monthly' -> every month on day_of_month at due_time
CREATE TABLE chore (
    chore_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id       BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    created_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    chore_name         TEXT NOT NULL,
    description        TEXT,
    repeats            TEXT NOT NULL DEFAULT 'none' CHECK (repeats IN ('none', 'weekly', 'monthly')),
    start_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    day_of_week        SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
    day_of_month       SMALLINT CHECK (day_of_month BETWEEN 1 AND 31),
    due_time           TIME,
    effort             TEXT NOT NULL DEFAULT 'medium' CHECK (effort IN ('easy', 'medium', 'hard')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (repeats = 'none'    AND day_of_week IS NULL     AND day_of_month IS NULL) OR
        (repeats = 'weekly'  AND day_of_week IS NOT NULL AND day_of_month IS NULL) OR
        (repeats = 'monthly' AND day_of_month IS NOT NULL AND day_of_week IS NULL)
    )
);

CREATE TABLE chore_rotation (
    chore_id        BIGINT NOT NULL REFERENCES chore(chore_id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    turn_order      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chore_id, user_id),
    UNIQUE (chore_id, turn_order)
);

-- One occurrence: who does the chore and when.
CREATE TABLE chore_assignment (
    assignment_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chore_id         BIGINT NOT NULL REFERENCES chore(chore_id) ON DELETE CASCADE,
    assigned_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    due_at           TIMESTAMPTZ NOT NULL,
    is_completed     BOOLEAN NOT NULL DEFAULT false,
    completed_at     TIMESTAMPTZ,
    last_reminded_at TIMESTAMPTZ,   -- throttles reminder notifications
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chore_id, due_at),      -- the generator can't create the same occurrence twice
    CHECK (is_completed = (completed_at IS NOT NULL))
);

CREATE TABLE chore_swap_request (
    swap_id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    requester_assignment_id BIGINT NOT NULL REFERENCES chore_assignment(assignment_id) ON DELETE CASCADE,
    target_assignment_id    BIGINT REFERENCES chore_assignment(assignment_id) ON DELETE CASCADE,
    type                    TEXT NOT NULL CHECK (type IN ('swap', 'skip')),
    request_message         TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    response_message        TEXT,
    requested_date          TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_date          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a swap needs a target assignment; a skip does not
    CHECK ((type = 'swap' AND target_assignment_id IS NOT NULL)
        OR (type = 'skip' AND target_assignment_id IS NULL)),
    CHECK (requester_assignment_id IS DISTINCT FROM target_assignment_id),
    CHECK ((status = 'pending') = (responded_date IS NULL))
);

-- =========================================================
-- Calendar
-- =========================================================

CREATE TABLE event (
    event_id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id            BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    created_by_user_id      BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    event_name              TEXT NOT NULL,
    event_date              TIMESTAMPTZ NOT NULL,
    end_date                TIMESTAMPTZ,
    location                TEXT,
    category                TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('hosting', 'meeting', 'other')),
    color                   TEXT,          -- color-coding and sorting the calendar
    reminder_minutes_before INTEGER CHECK (reminder_minutes_before >= 0),
    description             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date IS NULL OR end_date >= event_date)
);

-- Roommates tagged on an event. For hosting events, each tagged roommate
-- answers the "is it OK if I host?" check through response.
CREATE TABLE event_tag (
    event_id        BIGINT NOT NULL REFERENCES event(event_id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    response        TEXT CHECK (response IN ('pending', 'accepted', 'declined')),
    responded_date  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);

-- =========================================================
-- Money
-- =========================================================

CREATE TABLE wishlist_item (
    wishlist_item_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id       BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    created_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,  -- only the creator can edit
    item_name          TEXT NOT NULL,
    need_or_want       TEXT NOT NULL CHECK (need_or_want IN ('need', 'want')),
    estimated_price    NUMERIC(10, 2) CHECK (estimated_price >= 0),
    item_link          TEXT,
    description        TEXT,        -- why the household needs it
    is_bought          BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recurring_bill (
    bill_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id     BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    bill_name        TEXT NOT NULL,
    bill_type        TEXT NOT NULL CHECK (bill_type IN ('rent', 'utility', 'subscription')),
    amount           NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    due_day_of_month SMALLINT NOT NULL CHECK (due_day_of_month BETWEEN 1 AND 31),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expense (
    expense_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id     BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    paid_by_user_id  BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    -- one-to-one: a wishlist item becomes at most one expense when bought
    wishlist_item_id BIGINT UNIQUE REFERENCES wishlist_item(wishlist_item_id) ON DELETE SET NULL,
    -- one-to-many: a recurring bill creates an expense each month
    bill_id          BIGINT REFERENCES recurring_bill(bill_id) ON DELETE SET NULL,
    item_name        TEXT NOT NULL,
    total_amount     NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    purchase_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    receipt_photo    TEXT,           -- URL to the stored image
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Money sent from one roommate to another. Only status = 'confirmed'
-- counts toward balances.
CREATE TABLE payment (
    payment_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id    BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    payer_user_id   BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    payee_user_id   BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    amount          NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    paid_with       TEXT NOT NULL CHECK (paid_with IN ('venmo', 'zelle', 'apple_cash')),
    status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'confirmed', 'disputed')),
    paid_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (payer_user_id <> payee_user_id)
);

-- Each roommate's portion of an expense.
-- A share is paid back when settled_by_payment_id points to a payment
-- whose status is 'confirmed'. One payment can settle several shares.
-- The buyer's own share (user_id = expense.paid_by_user_id) is never owed.
CREATE TABLE expense_share (
    expense_id            BIGINT NOT NULL REFERENCES expense(expense_id) ON DELETE CASCADE,
    user_id               BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    amount_owed           NUMERIC(10, 2) NOT NULL CHECK (amount_owed >= 0),
    settled_by_payment_id BIGINT REFERENCES payment(payment_id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (expense_id, user_id)
);

-- =========================================================
-- Messages & Alerts
-- =========================================================

-- Sticky notes on the communication board. A note can tag a calendar
-- event, and replies point to the note they answer.
CREATE TABLE bulletin_message (
    message_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id      BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    sender_user_id    BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    event_id          BIGINT REFERENCES event(event_id) ON DELETE SET NULL,
    parent_message_id BIGINT REFERENCES bulletin_message(message_id) ON DELETE CASCADE,
    message_text      TEXT NOT NULL,
    is_pinned         BOOLEAN NOT NULL DEFAULT false,
    posted_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per recipient. section = which of the five dashboard sections
-- it lands in. source_type + source_id point at the record that caused it,
-- so "Check it out" can open it. Responses (accept/decline) live on the
-- source record (chore_swap_request.status, event_tag.response,
-- payment.status), not here.
CREATE TABLE notification (
    notification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    household_id    BIGINT NOT NULL REFERENCES household(household_id) ON DELETE CASCADE,
    actor_user_id   BIGINT REFERENCES users(user_id) ON DELETE SET NULL,   -- who caused it
    section         TEXT NOT NULL CHECK (section IN (
                        'chores',            -- swap requests and chore updates
                        'money',             -- money requests and payments
                        'expense_tracker',   -- new items added to the tracker
                        'system',            -- system updates and reminders
                        'calendar_board'     -- calendar updates, new board comments
                    )),
    source_type     TEXT CHECK (source_type IN (
                        'chore_assignment', 'chore_swap_request', 'expense',
                        'expense_share', 'payment', 'wishlist_item',
                        'event', 'bulletin_message'
                    )),
    source_id       BIGINT,
    message         TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((source_type IS NULL) = (source_id IS NULL))
);

CREATE TABLE app_feedback (
    feedback_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    type            TEXT NOT NULL CHECK (type IN ('bug', 'idea', 'other')),
    rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
    message         TEXT,
    submitted_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Attach the updated_at trigger to every table above
-- =========================================================

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'updated_at'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END LOOP;
END;
$$;

-- =========================================================
-- Indexes on the columns the app filters by most
-- =========================================================

CREATE INDEX idx_household_member_user   ON household_member (user_id);
CREATE INDEX idx_household_member_active ON household_member (household_id) WHERE left_date IS NULL;
CREATE INDEX idx_chore_household         ON chore (household_id);
CREATE INDEX idx_chore_assignment_user   ON chore_assignment (assigned_user_id, due_at);
CREATE INDEX idx_swap_target             ON chore_swap_request (target_assignment_id) WHERE status = 'pending';
CREATE INDEX idx_event_household_date    ON event (household_id, event_date);
CREATE INDEX idx_event_tag_user          ON event_tag (user_id);
CREATE INDEX idx_wishlist_household      ON wishlist_item (household_id) WHERE NOT is_bought;
CREATE INDEX idx_expense_household       ON expense (household_id, purchase_date);
CREATE INDEX idx_expense_share_user      ON expense_share (user_id);
CREATE INDEX idx_expense_share_payment   ON expense_share (settled_by_payment_id);
CREATE INDEX idx_payment_household       ON payment (household_id, paid_date);
CREATE INDEX idx_payment_payer           ON payment (payer_user_id);
CREATE INDEX idx_payment_payee           ON payment (payee_user_id);
CREATE INDEX idx_bulletin_household      ON bulletin_message (household_id, posted_date DESC);
CREATE INDEX idx_bulletin_event          ON bulletin_message (event_id);
CREATE INDEX idx_bulletin_parent         ON bulletin_message (parent_message_id);
CREATE INDEX idx_notification_user       ON notification (user_id, is_read, created_at DESC);
CREATE INDEX idx_notification_source     ON notification (source_type, source_id);

COMMIT;