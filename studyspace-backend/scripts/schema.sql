-- ═══════════════════════════════════════════════════════════════════════
--  StudySpace MAHE Bengaluru – Full Database Schema
--  Run: psql -U postgres -f scripts/schema.sql
-- ═══════════════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- fuzzy text search

-- ── ENUMS ───────────────────────────────────────────────────────────────────

CREATE TYPE user_role       AS ENUM ('student', 'staff', 'admin');
CREATE TYPE booking_status  AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
CREATE TYPE space_type      AS ENUM ('library', 'collaborative', 'study_hall', 'reading_room', 'seminar', 'outdoor', 'lab');
CREATE TYPE notif_type      AS ENUM ('booking_confirmed', 'booking_cancelled', 'booking_reminder', 'space_available', 'announcement', 'feedback_request');
CREATE TYPE amenity_type    AS ENUM ('wifi', 'ac', 'power_outlets', 'whiteboard', 'projector', 'tv_screen', 'coffee_machine', 'quiet_zone', 'natural_light', 'casual_seating', 'lockers', 'printing');

-- ── USERS ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      VARCHAR(20)  UNIQUE,                        -- e.g. 231040120
    full_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role    NOT NULL DEFAULT 'student',
    department      VARCHAR(100),
    phone           VARCHAR(20),
    avatar_url      VARCHAR(500),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    is_verified     BOOLEAN      NOT NULL DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email     ON users(email);
CREATE INDEX idx_users_student_id ON users(student_id);

-- ── REFRESH TOKENS ───────────────────────────────────────────────────────────

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    revoked     BOOLEAN      NOT NULL DEFAULT FALSE,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ── STUDY SPACES ─────────────────────────────────────────────────────────────

CREATE TABLE study_spaces (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(150) NOT NULL,
    code            VARCHAR(20)  NOT NULL UNIQUE,               -- e.g. LIB-L2
    description     TEXT,
    space_type      space_type   NOT NULL,
    capacity        SMALLINT     NOT NULL CHECK (capacity > 0),
    floor           VARCHAR(20),
    building        VARCHAR(100),
    map_x           DECIMAL(5,2) NOT NULL,                      -- % position on campus map
    map_y           DECIMAL(5,2) NOT NULL,
    emoji           VARCHAR(10)  DEFAULT '📚',
    image_url       VARCHAR(500),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    requires_approval BOOLEAN    NOT NULL DEFAULT FALSE,
    open_from       TIME         NOT NULL DEFAULT '08:00',
    open_until      TIME         NOT NULL DEFAULT '21:00',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spaces_type     ON study_spaces(space_type);
CREATE INDEX idx_spaces_active   ON study_spaces(is_active);
CREATE INDEX idx_spaces_name_trgm ON study_spaces USING gin(name gin_trgm_ops);

-- ── SPACE AMENITIES ──────────────────────────────────────────────────────────

CREATE TABLE space_amenities (
    space_id    UUID         NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    amenity     amenity_type NOT NULL,
    PRIMARY KEY (space_id, amenity)
);

-- ── SPACE CLOSURES (maintenance, events, etc.) ───────────────────────────────

CREATE TABLE space_closures (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id    UUID        NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    reason      TEXT,
    created_by  UUID        REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time)
);

CREATE INDEX idx_closures_space_time ON space_closures(space_id, start_time, end_time);

-- ── TIME SLOTS ───────────────────────────────────────────────────────────────

CREATE TABLE time_slots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id        UUID     NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    slot_date       DATE     NOT NULL,
    start_time      TIME     NOT NULL,
    end_time        TIME     NOT NULL,
    is_available    BOOLEAN  NOT NULL DEFAULT TRUE,
    max_bookings    SMALLINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (space_id, slot_date, start_time)
);

CREATE INDEX idx_slots_space_date ON time_slots(space_id, slot_date);
CREATE INDEX idx_slots_available  ON time_slots(is_available) WHERE is_available = TRUE;

-- ── BOOKINGS ─────────────────────────────────────────────────────────────────

CREATE TABLE bookings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_ref     VARCHAR(12)    NOT NULL UNIQUE,              -- e.g. SS-202405-A1B2
    user_id         UUID           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    space_id        UUID           NOT NULL REFERENCES study_spaces(id) ON DELETE RESTRICT,
    slot_id         UUID           REFERENCES time_slots(id) ON DELETE SET NULL,
    booking_date    DATE           NOT NULL,
    start_time      TIME           NOT NULL,
    end_time        TIME           NOT NULL,
    status          booking_status NOT NULL DEFAULT 'confirmed',
    attendees_count SMALLINT       DEFAULT 1,
    purpose         VARCHAR(200),
    admin_notes     TEXT,
    checked_in_at   TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    UUID           REFERENCES users(id),
    cancel_reason   TEXT,
    reminder_sent   BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time),
    CHECK (attendees_count >= 1)
);

CREATE INDEX idx_bookings_user        ON bookings(user_id);
CREATE INDEX idx_bookings_space       ON bookings(space_id);
CREATE INDEX idx_bookings_date        ON bookings(booking_date);
CREATE INDEX idx_bookings_status      ON bookings(status);
CREATE INDEX idx_bookings_ref         ON bookings(booking_ref);
CREATE INDEX idx_bookings_user_date   ON bookings(user_id, booking_date);
CREATE INDEX idx_bookings_space_date  ON bookings(space_id, booking_date, status);

-- ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

CREATE TABLE notifications (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        notif_type  NOT NULL,
    title       VARCHAR(150) NOT NULL,
    message     TEXT        NOT NULL,
    data        JSONB,                                          -- extra structured payload
    is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
    read_at     TIMESTAMPTZ,
    booking_id  UUID        REFERENCES bookings(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user      ON notifications(user_id);
CREATE INDEX idx_notif_unread    ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notif_created   ON notifications(created_at DESC);

-- ── REVIEWS / FEEDBACK ───────────────────────────────────────────────────────

CREATE TABLE reviews (
    id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    space_id    UUID    NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    booking_id  UUID    REFERENCES bookings(id) ON DELETE SET NULL,
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    is_visible  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, booking_id)                               -- one review per booking
);

CREATE INDEX idx_reviews_space   ON reviews(space_id);
CREATE INDEX idx_reviews_user    ON reviews(user_id);
CREATE INDEX idx_reviews_visible ON reviews(space_id, is_visible) WHERE is_visible = TRUE;

-- ── SPACE RATING CACHE (materialised) ────────────────────────────────────────

CREATE TABLE space_rating_cache (
    space_id        UUID  PRIMARY KEY REFERENCES study_spaces(id) ON DELETE CASCADE,
    avg_rating      DECIMAL(3,2) DEFAULT 0,
    review_count    INTEGER      DEFAULT 0,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── PASSWORD RESET TOKENS ────────────────────────────────────────────────────

CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    used        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── EMAIL VERIFICATION TOKENS ────────────────────────────────────────────────

CREATE TABLE email_verification_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOG ────────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(80) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   UUID,
    old_data    JSONB,
    new_data    JSONB,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user    ON audit_log(user_id);
CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ── FUNCTIONS & TRIGGERS ─────────────────────────────────────────────────────

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bookings_updated_at     BEFORE UPDATE ON bookings     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_reviews_updated_at      BEFORE UPDATE ON reviews      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_study_spaces_updated_at BEFORE UPDATE ON study_spaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Refresh rating cache after review insert/update/delete
CREATE OR REPLACE FUNCTION refresh_space_rating()
RETURNS TRIGGER AS $$
DECLARE
    _space_id UUID := COALESCE(NEW.space_id, OLD.space_id);
BEGIN
    INSERT INTO space_rating_cache (space_id, avg_rating, review_count, updated_at)
    SELECT space_id, ROUND(AVG(rating)::NUMERIC, 2), COUNT(*), NOW()
    FROM reviews WHERE space_id = _space_id AND is_visible = TRUE
    GROUP BY space_id
    ON CONFLICT (space_id) DO UPDATE
        SET avg_rating = EXCLUDED.avg_rating,
            review_count = EXCLUDED.review_count,
            updated_at = NOW();
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_rating
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION refresh_space_rating();

-- Generate booking reference  (SS-YYYYMM-XXXX)
CREATE OR REPLACE FUNCTION generate_booking_ref()
RETURNS TRIGGER AS $$
BEGIN
    NEW.booking_ref := 'SS-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || UPPER(SUBSTRING(MD5(NEW.id::TEXT), 1, 4));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_booking_ref
BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION generate_booking_ref();

-- Prevent double-booking (application-level guard; DB-level extra safety)
CREATE OR REPLACE FUNCTION check_booking_conflict()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM bookings
        WHERE space_id    = NEW.space_id
          AND booking_date = NEW.booking_date
          AND status       NOT IN ('cancelled')
          AND id           <> NEW.id
          AND (start_time, end_time) OVERLAPS (NEW.start_time, NEW.end_time)
    ) THEN
        RAISE EXCEPTION 'Booking conflict: space already reserved for this time slot';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_booking_conflict
BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION check_booking_conflict();

-- Mark notifications as read
CREATE OR REPLACE FUNCTION mark_notification_read()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_read = TRUE AND OLD.is_read = FALSE THEN
        NEW.read_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notif_read
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION mark_notification_read();
