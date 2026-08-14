-- Supabase Storage Policies for Documents Bucket
-- 
-- IMPORTANT: These policies must be created on the storage.objects table
-- 
-- ⚠️ WARNING: This SQL script CANNOT be run directly in the Supabase SQL Editor
-- because the storage.objects table requires special permissions that regular
-- database users don't have (it's owned by supabase_storage_admin).
-- 
-- Regular database users (including SQL Editor) cannot use SET ROLE to switch
-- to supabase_storage_admin - you'll get "permission denied" error.
-- 
-- OPTIONS:
-- 
-- Option 1: Supabase Dashboard UI (Easiest - Recommended)
-- 1. Go to Storage → Policies → Schema tab
-- 2. Under "Other policies under storage.objects", click "New policy"
-- 3. Create each policy manually using the SQL below as a reference
-- 
-- Option 2: Supabase CLI (If you have CLI installed)
-- Run: supabase db query --file STORAGE_POLICIES.sql
-- (The CLI may have elevated permissions that allow it to work)
-- 
-- This file is provided as a reference for the policy definitions.
-- See DEPLOYMENT_SETUP.md for detailed step-by-step instructions.
-- 
-- NOTE: The '::text' type casting you see in the UI is normal and correct.
-- PostgreSQL automatically adds this for type safety.

-- NOTE: SET ROLE supabase_storage_admin does NOT work in SQL Editor
-- Regular database users get "permission denied" error when trying to switch roles
-- You must use the Dashboard UI (Option 1) or Supabase CLI (Option 2) instead

-- First, drop any existing policies that might conflict
DROP POLICY IF EXISTS "test" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users full access to documents bucket" ON storage.objects;

-- Enable RLS on storage.objects (if not already enabled)
-- This will fail if you don't have permission - use Dashboard UI instead
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- IMPORTANT: Create policies at the SCHEMA level (storage.objects), not just bucket level
-- This ensures they apply correctly to all operations

-- Policy for INSERT (upload) - WITH CHECK is required for INSERT
-- Explicitly check that user is authenticated via auth.uid()
CREATE POLICY "Allow authenticated users to upload to documents bucket"
ON storage.objects
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  auth.uid() IS NOT NULL
);

-- Policy for SELECT (download/read) - USING is required for SELECT
-- Explicitly check that user is authenticated via auth.uid()
CREATE POLICY "Allow authenticated users to read from documents bucket"
ON storage.objects
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  auth.uid() IS NOT NULL
);

-- Policy for UPDATE - needs both USING and WITH CHECK
-- Explicitly check that user is authenticated via auth.uid()
CREATE POLICY "Allow authenticated users to update documents bucket"
ON storage.objects
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents' AND
  auth.uid() IS NOT NULL
)
WITH CHECK (
  bucket_id = 'documents' AND
  auth.uid() IS NOT NULL
);

-- Policy for DELETE - USING is required for DELETE
-- Explicitly check that user is authenticated via auth.uid()
CREATE POLICY "Allow authenticated users to delete from documents bucket"
ON storage.objects
AS PERMISSIVE
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  auth.uid() IS NOT NULL
);

-- Alternative: Single policy for ALL operations (if the above doesn't work, try this)
-- Uncomment this and comment out the above if needed:
/*
CREATE POLICY "Allow authenticated users full access to documents bucket"
ON storage.objects
AS PERMISSIVE
FOR ALL
TO authenticated
USING (
  bucket_id = 'documents'
)
WITH CHECK (
  bucket_id = 'documents'
);
*/

-- Option 2: Separate policies for each operation (more granular control)
-- Uncomment these if you prefer separate policies instead of the single policy above

-- -- Policy 1: Allow authenticated users to INSERT (upload) files to the documents bucket
-- CREATE POLICY "Allow authenticated users to upload documents"
-- ON storage.objects
-- FOR INSERT
-- TO authenticated
-- WITH CHECK (
--   bucket_id = 'documents'
-- );

-- -- Policy 2: Allow authenticated users to SELECT (download/read) files from the documents bucket
-- CREATE POLICY "Allow authenticated users to read documents"
-- ON storage.objects
-- FOR SELECT
-- TO authenticated
-- USING (
--   bucket_id = 'documents'
-- );

-- -- Policy 3: Allow authenticated users to UPDATE files in the documents bucket
-- CREATE POLICY "Allow authenticated users to update documents"
-- ON storage.objects
-- FOR UPDATE
-- TO authenticated
-- USING (
--   bucket_id = 'documents'
-- )
-- WITH CHECK (
--   bucket_id = 'documents'
-- );

-- -- Policy 4: Allow authenticated users to DELETE files from the documents bucket
-- CREATE POLICY "Allow authenticated users to delete documents"
-- ON storage.objects
-- FOR DELETE
-- TO authenticated
-- USING (
--   bucket_id = 'documents'
-- );

-- Optional: More restrictive policies based on file path or ownership
-- Uncomment and modify as needed:

-- Example: Only allow users to upload to their own template folders
-- CREATE POLICY "Allow users to upload to their templates"
-- ON storage.objects
-- FOR INSERT
-- TO authenticated
-- WITH CHECK (
--   bucket_id = 'documents' AND
--   (storage.foldername(name))[1] = 'templates'
-- );

-- Example: Only allow users to read files they uploaded (based on metadata)
-- CREATE POLICY "Allow users to read their own documents"
-- ON storage.objects
-- FOR SELECT
-- TO authenticated
-- USING (
--   bucket_id = 'documents' AND
--   (metadata->>'created_by_user_id')::int = auth.uid()::text
-- );

