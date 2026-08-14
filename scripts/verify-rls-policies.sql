-- ============================================================================
-- VERIFY AND CREATE RLS POLICIES FOR USERS TABLE
-- ============================================================================
-- This script verifies that RLS policies exist for the users table
-- and creates them if they don't exist.

-- First, check if RLS is enabled
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'users';

-- Check existing policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename = 'users'
ORDER BY policyname;

-- Enable RLS if not already enabled
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;

-- Create policies if they don't exist
DO $$
BEGIN
    -- SELECT policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'users' 
        AND policyname = 'Allow anon reads on users'
    ) THEN
        CREATE POLICY "Allow anon reads on users" 
        ON public.users 
        FOR SELECT 
        TO anon 
        USING (true);
        RAISE NOTICE 'Created SELECT policy for users table';
    ELSE
        RAISE NOTICE 'SELECT policy already exists for users table';
    END IF;
    
    -- INSERT policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'users' 
        AND policyname = 'Allow anon inserts on users'
    ) THEN
        CREATE POLICY "Allow anon inserts on users" 
        ON public.users 
        FOR INSERT 
        TO anon 
        WITH CHECK (true);
        RAISE NOTICE 'Created INSERT policy for users table';
    ELSE
        RAISE NOTICE 'INSERT policy already exists for users table';
    END IF;
    
    -- UPDATE policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'users' 
        AND policyname = 'Allow anon updates on users'
    ) THEN
        CREATE POLICY "Allow anon updates on users" 
        ON public.users 
        FOR UPDATE 
        TO anon 
        USING (true) 
        WITH CHECK (true);
        RAISE NOTICE 'Created UPDATE policy for users table';
    ELSE
        RAISE NOTICE 'UPDATE policy already exists for users table';
    END IF;
    
    -- DELETE policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'users' 
        AND policyname = 'Allow anon deletes on users'
    ) THEN
        CREATE POLICY "Allow anon deletes on users" 
        ON public.users 
        FOR DELETE 
        TO anon 
        USING (true);
        RAISE NOTICE 'Created DELETE policy for users table';
    ELSE
        RAISE NOTICE 'DELETE policy already exists for users table';
    END IF;
END $$;

-- Test query as anon role (simulate what the frontend does)
-- Note: This will run as the current user, but shows what should work
SELECT 
    user_id,
    email,
    role,
    is_archived
FROM public.users
WHERE user_id = 1
LIMIT 1;

-- Show all users (to verify RLS allows access)
SELECT 
    COUNT(*) as total_users,
    COUNT(*) FILTER (WHERE is_archived = false) as active_users,
    COUNT(*) FILTER (WHERE is_archived = true) as archived_users
FROM public.users;

-- ============================================================================
-- TEST AS ANON ROLE (CRITICAL - This simulates frontend queries)
-- ============================================================================
-- Switch to anon role to test if policies actually work
SET ROLE anon;

-- Test 1: Can we query all users?
SELECT 
    user_id,
    email,
    role,
    is_archived
FROM public.users
ORDER BY user_id
LIMIT 5;

-- Test 2: Can we query user_id = 1 specifically?
SELECT 
    user_id,
    email,
    role,
    is_archived
FROM public.users
WHERE user_id = 1;

-- Test 3: Count users
SELECT COUNT(*) as user_count FROM public.users;

-- Reset role
RESET ROLE;

