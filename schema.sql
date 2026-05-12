-- ============================================================================
-- VoiceTask Agent — PostgreSQL Schema
-- ----------------------------------------------------------------------------
-- A voice-controlled task manager. Tasks are created/updated/deleted only
-- through voice. This schema stores tasks plus a short conversation log used
-- for context-aware follow-ups (e.g. "move the second one to tomorrow").
-- ============================================================================

-- Enable UUID generation. pgcrypto ships with most managed Postgres providers.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pg_trgm enables fuzzy/partial title matching used by the task matcher.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- users (single-user MVP — kept for future auth)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL DEFAULT 'default-user',
    email         TEXT UNIQUE,
    password_hash TEXT,
    timezone      TEXT NOT NULL DEFAULT 'UTC',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent migration for existing deployments.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email         TEXT,
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Allow email to be unique when present (NULLs are permitted for legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users (lower(email)) WHERE email IS NOT NULL;

-- Seed a default user so existing data keeps working without auth.
INSERT INTO users (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default-user')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- sessions — opaque token → user mapping, for simple session handling.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ----------------------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    scheduled_at  TIMESTAMPTZ,
    due_date      DATE,
    time_label    TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'completed')),
    priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low', 'normal', 'high')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_scheduled
    ON tasks (user_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status
    ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm
    ON tasks USING GIN (lower(title) gin_trgm_ops);

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- conversation_messages — running log of voice turns (user + assistant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_user_created
    ON conversation_messages (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- conversation_state — single-row per user, holds short-term context
-- (last listed task ids, pending confirmation, last action, etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_state (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_user_transcript TEXT,
    last_assistant_text  TEXT,
    last_action          JSONB,
    last_listed_task_ids UUID[] NOT NULL DEFAULT '{}',
    last_created_task_ids UUID[] NOT NULL DEFAULT '{}',
    last_updated_task_ids UUID[] NOT NULL DEFAULT '{}',
    pending_confirmation JSONB,
    pending_draft        JSONB,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent migration for existing deployments.
ALTER TABLE conversation_state
    ADD COLUMN IF NOT EXISTS pending_draft JSONB;

INSERT INTO conversation_state (user_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;
