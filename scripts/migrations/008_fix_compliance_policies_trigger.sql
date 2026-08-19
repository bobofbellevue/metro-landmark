-- ============================================================================
-- Fix compliance_policies trigger function
-- ============================================================================
-- This script ensures the update_compliance_policies_updated_at() function
-- and trigger exist. Run this if you're getting FUNCTION_INVOCATION_FAILED
-- errors on the Compliance Policies page.
-- ============================================================================

-- Create or replace the trigger function
CREATE OR REPLACE FUNCTION update_compliance_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_update_compliance_policies_updated_at ON compliance_policies;

-- Create the trigger
CREATE TRIGGER trigger_update_compliance_policies_updated_at
  BEFORE UPDATE ON compliance_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_compliance_policies_updated_at();
