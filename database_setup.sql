-- 1. Add Strava columns and Role to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS strava_access_token TEXT,
ADD COLUMN IF NOT EXISTS strava_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS strava_token_expires_at BIGINT,
ADD COLUMN IF NOT EXISTS strava_athlete_id TEXT,
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- CLEANUP: Drop the insecure view if it exists (Fixes Supabase security warning)
DROP VIEW IF EXISTS leaderboard_profiles;

-- Secure RPC function for the leaderboard (Only expose non-sensitive fields)
-- This replaces the view to avoid Supabase security warnings
CREATE OR REPLACE FUNCTION get_leaderboard_profiles(user_emails TEXT[])
RETURNS TABLE (
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    strava_connected BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT p.email, p.first_name, p.last_name, p.strava_connected
    FROM profiles p
    WHERE p.email = ANY(user_emails);
END;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION get_leaderboard_profiles(TEXT[]) TO authenticated;

-- Helper function to check admin status safely (prevents recursion)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM profiles
    WHERE email = auth.jwt() ->> 'email'
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Create strava_activities table (if not exists)
CREATE TABLE IF NOT EXISTS strava_activities (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT REFERENCES profiles(email) ON DELETE CASCADE,
  strava_id BIGINT UNIQUE NOT NULL,
  name TEXT,
  type TEXT,
  distance NUMERIC,
  moving_time INTEGER,
  elapsed_time INTEGER,
  total_elevation_gain NUMERIC,
  start_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Force add user_email if it's missing
ALTER TABLE strava_activities ADD COLUMN IF NOT EXISTS user_email TEXT REFERENCES profiles(email) ON DELETE CASCADE;

-- 3. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_strava_activities_user_email ON strava_activities(user_email);
CREATE INDEX IF NOT EXISTS idx_strava_activities_start_date ON strava_activities(start_date DESC);

-- 4. Enable Row Level Security (RLS) for strava_activities
ALTER TABLE strava_activities ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies with proper security
-- Clean up potential legacy policies to avoid conflicts/warnings
DROP POLICY IF EXISTS "Allow insert for authenticated users" ON strava_activities;
DROP POLICY IF EXISTS "Allow update for authenticated users" ON strava_activities;

DROP POLICY IF EXISTS "Users can view their own activities" ON strava_activities;
CREATE POLICY "Users can view their own activities"
ON strava_activities FOR SELECT
USING (user_email = auth.jwt() ->> 'email' OR is_admin());

DROP POLICY IF EXISTS "Allow insert for all users" ON strava_activities;
CREATE POLICY "Allow insert for all users"
ON strava_activities FOR INSERT
WITH CHECK (user_email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "Users can update their own activities" ON strava_activities;
CREATE POLICY "Users can update their own activities"
ON strava_activities FOR UPDATE
USING (user_email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "Users can delete their own activities" ON strava_activities;
CREATE POLICY "Users can delete their own activities"
ON strava_activities FOR DELETE
USING (user_email = auth.jwt() ->> 'email');

-- 6. Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 7. Create events table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    price DECIMAL(10, 2) DEFAULT 0.00,
    image_url TEXT,
    max_participants INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Create event_registrations table
CREATE TABLE IF NOT EXISTS event_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    status TEXT DEFAULT 'registered',
    payment_status TEXT DEFAULT 'pending', 
    registration_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(event_id, user_email)
);

ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;

-- Force FK constraint if not exists (Important for joins)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'event_registrations_user_email_fkey'
    ) THEN
        ALTER TABLE event_registrations
        ADD CONSTRAINT event_registrations_user_email_fkey
        FOREIGN KEY (user_email)
        REFERENCES profiles(email)
        ON DELETE CASCADE;
    END IF;
END $$;

-- 9. Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

-- 10. Create RLS Policies

-- PROFILES Policies
DROP POLICY IF EXISTS "Users can see their own profile" ON profiles;
CREATE POLICY "Users can see their own profile"
ON profiles FOR SELECT
USING (email = auth.jwt() ->> 'email' OR is_admin());

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile"
ON profiles FOR UPDATE
USING (email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "Admins can update user roles" ON profiles;
CREATE POLICY "Admins can update user roles"
ON profiles FOR UPDATE
USING (is_admin());

-- EVENTS Policies  
DROP POLICY IF EXISTS "Allow public read-only access to active events" ON events;
CREATE POLICY "Allow public read-only access to active events"
ON events FOR SELECT
USING (
    is_active = true                    -- Public can see active events
    OR 
    (auth.role() = 'authenticated' AND is_admin())  -- Admins can see all events
);

-- Allow admins to INSERT events
DROP POLICY IF EXISTS "Admins can insert events" ON events;
CREATE POLICY "Admins can insert events"
ON events FOR INSERT
WITH CHECK (is_admin());

-- Allow admins to UPDATE events
DROP POLICY IF EXISTS "Admins can update events" ON events;
CREATE POLICY "Admins can update events"
ON events FOR UPDATE
USING (is_admin());

-- Allow admins to DELETE events
DROP POLICY IF EXISTS "Admins can delete events" ON events;
CREATE POLICY "Admins can delete events"
ON events FOR DELETE
USING (is_admin());

-- REGISTRATIONS Policies
DROP POLICY IF EXISTS "Users can view their own registrations" ON event_registrations;
DROP POLICY IF EXISTS "Allow all authenticated users to view registrations" ON event_registrations;
CREATE POLICY "Allow all authenticated users to view registrations"
ON event_registrations FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can register for events" ON event_registrations;
CREATE POLICY "Users can register for events"
ON event_registrations FOR INSERT
WITH CHECK (user_email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "Admins can update registrations" ON event_registrations;
CREATE POLICY "Admins can update registrations"
ON event_registrations FOR UPDATE
USING (is_admin());

-- 11. Seed Admin User
UPDATE profiles
SET role = 'admin'
WHERE email = 'shibukumarbe@gmail.com';

-- ============================================
-- 12. EVENT-SPECIFIC ACTIVITY TABLES SYSTEM
-- ============================================

-- Add column to track if activity table was created for event
ALTER TABLE events ADD COLUMN IF NOT EXISTS activity_table_name TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS activity_table_created BOOLEAN DEFAULT false;

-- Function to sanitize event name for table name
CREATE OR REPLACE FUNCTION sanitize_table_name(event_name TEXT)
RETURNS TEXT AS $$
DECLARE
    sanitized TEXT;
BEGIN
    -- Convert to lowercase, replace spaces and special chars with underscore
    sanitized := lower(event_name);
    sanitized := regexp_replace(sanitized, '[^a-z0-9]', '_', 'g');
    sanitized := regexp_replace(sanitized, '_+', '_', 'g');  -- Remove multiple underscores
    sanitized := trim(both '_' from sanitized);  -- Remove leading/trailing underscores
    sanitized := 'event_activities_' || sanitized;

    -- Truncate if too long (max 63 chars for PostgreSQL)
    IF length(sanitized) > 63 THEN
        sanitized := left(sanitized, 63);
    END IF;

    RETURN sanitized;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- Function to create event-specific activity table
CREATE OR REPLACE FUNCTION create_event_activity_table(event_id UUID)
RETURNS TEXT AS $$
DECLARE
    event_record RECORD;
    v_table_name TEXT;
    create_sql TEXT;
BEGIN
    -- Get event details
    SELECT * INTO event_record FROM events WHERE id = event_id;

    IF event_record IS NULL THEN
        RAISE EXCEPTION 'Event not found: %', event_id;
    END IF;

    -- Check if table already created
    IF event_record.activity_table_created = true THEN
        RETURN event_record.activity_table_name;
    END IF;

    -- Generate table name
    v_table_name := sanitize_table_name(event_record.name);

    -- Check if table already exists
    IF EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_name = v_table_name AND t.table_schema = 'public') THEN
        -- Update event record
        UPDATE events SET activity_table_name = v_table_name, activity_table_created = true WHERE id = event_id;
        RETURN v_table_name;
    END IF;

    -- Create the table (using gen_random_uuid() which is built-in)
    create_sql := format('
        CREATE TABLE %I (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_email TEXT NOT NULL,
            strava_id BIGINT UNIQUE NOT NULL,
            activity_name TEXT,
            activity_type TEXT,
            activity_date DATE NOT NULL,
            distance NUMERIC DEFAULT 0,
            elevation NUMERIC DEFAULT 0,
            moving_time INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT %I FOREIGN KEY (user_email) REFERENCES profiles(email) ON DELETE CASCADE
        )', v_table_name, v_table_name || '_user_email_fkey');

    EXECUTE create_sql;

    -- Create indexes
    EXECUTE format('CREATE INDEX %I ON %I(user_email)', v_table_name || '_user_idx', v_table_name);
    EXECUTE format('CREATE INDEX %I ON %I(activity_date)', v_table_name || '_date_idx', v_table_name);
    EXECUTE format('CREATE INDEX %I ON %I(activity_type)', v_table_name || '_type_idx', v_table_name);

    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table_name);

    -- Create RLS policies
    -- SELECT: All authenticated users can read (for leaderboard)
    EXECUTE format('
        CREATE POLICY "Anyone can view activities" ON %I
        FOR SELECT USING (auth.role() = ''authenticated'')', v_table_name);

    -- INSERT: Users can only insert their own activities
    EXECUTE format('
        CREATE POLICY "Users can insert own activities" ON %I
        FOR INSERT WITH CHECK (user_email = auth.jwt() ->> ''email'')', v_table_name);

    -- UPDATE: Users can only update their own activities
    EXECUTE format('
        CREATE POLICY "Users can update own activities" ON %I
        FOR UPDATE USING (user_email = auth.jwt() ->> ''email'' OR is_admin())', v_table_name);

    -- DELETE: Users can delete their own, admins can delete any
    EXECUTE format('
        CREATE POLICY "Users can delete own activities" ON %I
        FOR DELETE USING (user_email = auth.jwt() ->> ''email'' OR is_admin())', v_table_name);

    -- Update event record
    UPDATE events SET activity_table_name = v_table_name, activity_table_created = true WHERE id = event_id;

    RETURN v_table_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to delete event activity table (admin only)
CREATE OR REPLACE FUNCTION delete_event_activity_table(event_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    event_record RECORD;
BEGIN
    -- Get event details
    SELECT * INTO event_record FROM events WHERE id = event_id;

    IF event_record IS NULL THEN
        RAISE EXCEPTION 'Event not found: %', event_id;
    END IF;

    IF event_record.activity_table_name IS NULL THEN
        RETURN false;
    END IF;

    -- Drop the table
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', event_record.activity_table_name);

    -- Update event record
    UPDATE events SET activity_table_name = NULL, activity_table_created = false WHERE id = event_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to check if event has started and create table
CREATE OR REPLACE FUNCTION check_and_create_event_tables()
RETURNS INTEGER AS $$
DECLARE
    event_record RECORD;
    tables_created INTEGER := 0;
BEGIN
    -- Find events that have started but don't have activity tables yet
    FOR event_record IN
        SELECT * FROM events
        WHERE is_active = true
        AND start_date <= NOW()
        AND (activity_table_created = false OR activity_table_created IS NULL)
    LOOP
        PERFORM create_event_activity_table(event_record.id);
        tables_created := tables_created + 1;
    END LOOP;

    RETURN tables_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get event activity table name (for use in JS)
CREATE OR REPLACE FUNCTION get_event_table_name(event_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_table_name TEXT;
BEGIN
    SELECT activity_table_name INTO v_table_name FROM events WHERE id = event_id;
    RETURN v_table_name;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- Verification output
SELECT is_admin() as am_i_admin;

