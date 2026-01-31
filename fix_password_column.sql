-- ============================================
-- FIX: Remove password column from profiles table
-- ============================================
-- 
-- ISSUE: Signup fails with "null value in column 'password' of relation 'profiles' violates not-null constraint"
--
-- WHY: Supabase Auth handles passwords securely in the auth.users table (encrypted).
--      The profiles table should ONLY store user profile data, NOT authentication credentials.
--
-- SOLUTION: Remove the password column from the profiles table entirely.
--
-- RUN THIS IN: Supabase SQL Editor
-- ============================================

ALTER TABLE profiles DROP COLUMN IF EXISTS password;

-- Verification: Check that the column no longer exists
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
ORDER BY ordinal_position;
