-- ============================================================
--  NeuroSentinel AI — Supabase Database Schema
--  Run this entire file in your Supabase SQL Editor
-- ============================================================


-- ============================================================
-- 1. USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL UNIQUE,
    role        TEXT        NOT NULL DEFAULT 'user'
                            CHECK (role IN ('user', 'admin', 'doctor', 'clinician', 'researcher', 'patient')),
    onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
    preferences JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ============================================================
-- 2. REPORTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reports (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    filename    TEXT        NOT NULL,
    storage_path TEXT,
    status      TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    summary     TEXT,
    result_label TEXT,
    event_count INTEGER,
    confidence_score DOUBLE PRECISION,
    quality_grade TEXT,
    risk_level  TEXT,
    duration_minutes DOUBLE PRECISION,
    report_json JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER reports_updated_at
    BEFORE UPDATE ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Index for fast user-based lookups
CREATE INDEX IF NOT EXISTS reports_user_id_idx ON public.reports(user_id);


-- ============================================================
-- 3. CHAT_MESSAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role        TEXT        NOT NULL
                            CHECK (role IN ('user', 'assistant', 'system')),
    content     TEXT        NOT NULL,
    report_id   UUID        REFERENCES public.reports(id) ON DELETE SET NULL,
    page_context TEXT,
    metadata    JSONB       DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast conversation history retrieval
CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx  ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON public.chat_messages(created_at);
CREATE INDEX IF NOT EXISTS chat_messages_report_id_idx ON public.chat_messages(report_id);


-- ============================================================
-- 4. EEG_ANALYSIS_RESULTS TABLE
-- ============================================================
-- Stores raw inference results linked to a report.
-- Separate from reports table to keep heavy JSON payloads isolated.
CREATE TABLE IF NOT EXISTS public.eeg_analysis_results (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID        NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    result_json     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eeg_results_report_id_idx ON public.eeg_analysis_results(report_id);
CREATE INDEX IF NOT EXISTS eeg_results_user_id_idx   ON public.eeg_analysis_results(user_id);


-- ============================================================
-- 5. ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================================
-- IMPORTANT: ALL tables must have RLS enabled before going to production.
-- Having policies without enabling RLS means the policies are silently ignored.
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_analysis_results ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 5. RLS POLICIES — USERS TABLE
-- ============================================================

-- Users can read their own row only
CREATE POLICY "users: select own row"
    ON public.users
    FOR SELECT
    USING (auth.uid() = id);

-- Users can update their own row only
CREATE POLICY "users: update own row"
    ON public.users
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Supabase Auth trigger will insert; allow authenticated insert matching uid
CREATE POLICY "users: insert own row"
    ON public.users
    FOR INSERT
    WITH CHECK (auth.uid() = id);


-- ============================================================
-- 6. RLS POLICIES — REPORTS TABLE
-- ============================================================

-- Users can only see their own reports
CREATE POLICY "reports: select own reports"
    ON public.reports
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create reports for themselves only
CREATE POLICY "reports: insert own reports"
    ON public.reports
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own reports
CREATE POLICY "reports: update own reports"
    ON public.reports
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own reports
CREATE POLICY "reports: delete own reports"
    ON public.reports
    FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
-- 7. RLS POLICIES — CHAT_MESSAGES TABLE
-- ============================================================

-- Users can only read their own messages
CREATE POLICY "chat_messages: select own messages"
    ON public.chat_messages
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can only insert messages for themselves
CREATE POLICY "chat_messages: insert own messages"
    ON public.chat_messages
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own messages (e.g., clear history)
CREATE POLICY "chat_messages: delete own messages"
    ON public.chat_messages
    FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
-- 8. OPTIONAL: Auto-create user profile on sign-up
--    Hooks into Supabase Auth → inserts row into public.users
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, role)
    VALUES (NEW.id, NEW.email, 'user')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Done! All tables, indexes, RLS, and policies are set up.
-- ============================================================
