-- Make archived_by_user_id nullable to handle cases where user doesn't exist in users table
-- This allows archiving even if the authenticated user isn't in the users table yet

ALTER TABLE landlords ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE properties ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE units ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE leases ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE vendors ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE maintenance_requests ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE templates ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN archived_by_user_id DROP NOT NULL;
ALTER TABLE pm_companies ALTER COLUMN archived_by_user_id DROP NOT NULL;
