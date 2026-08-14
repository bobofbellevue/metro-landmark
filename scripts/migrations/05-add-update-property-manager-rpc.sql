-- ============================================================================
-- Migration: Add update_property_manager RPC Function
-- ============================================================================
-- This migration creates an RPC function to update the manager_id column
-- on properties, bypassing PostgREST schema cache validation issues.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_property_manager(
    p_property_id INTEGER,
    p_manager_id INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
SECURITY DEFINER
AS $$
BEGIN
    -- Directly update the manager_id column
    -- This bypasses PostgREST schema cache validation
    UPDATE properties
    SET manager_id = p_manager_id
    WHERE property_id = p_property_id;
    
    -- Raise exception if no rows were updated
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Property with id % not found', p_property_id;
    END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_property_manager(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION update_property_manager(INTEGER, INTEGER) TO anon;

-- Ensure the function is exposed to PostgREST
-- PostgREST automatically exposes functions in the public schema
-- but we need to make sure it's accessible
COMMENT ON FUNCTION update_property_manager(INTEGER, INTEGER) IS 'Updates the manager_id for a property, bypassing PostgREST schema cache validation';

