-- 1. Add Strava columns and Role to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS strava_access_token TEXT,
ADD COLUMN IF NOT EXISTS strava_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS strava_token_expires_at BIGINT,
ADD COLUMN IF NOT EXISTS strava_athlete_id TEXT,
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

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
CREATE POLICY "Users can view their own registrations"
ON event_registrations FOR SELECT
USING (user_email = auth.jwt() ->> 'email' OR is_admin());

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

-- Verification output
SELECT is_admin() as am_i_admin;

