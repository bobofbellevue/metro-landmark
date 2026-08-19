-- ============================================================================
-- Migration: Add Schema Discovery Functions for Orphaned Records
-- ============================================================================
-- This migration creates functions to dynamically discover database schema
-- information, allowing the orphaned records system to work automatically
-- without hardcoding table relationships.
-- ============================================================================

-- Function to discover all foreign key relationships
CREATE OR REPLACE FUNCTION discover_foreign_keys()
RETURNS JSON
LANGUAGE plpgsql
SET search_path = public, pg_catalog
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'child_table', tc.table_name,
      'child_column', kcu.column_name,
      'parent_table', ccu.table_name,
      'parent_column', ccu.column_name,
      'on_delete', rc.delete_rule
    )
    ORDER BY tc.table_name, kcu.ordinal_position
  ) INTO result
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
    AND rc.constraint_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public';
  
  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Function to discover primary key columns for all tables
CREATE OR REPLACE FUNCTION discover_primary_keys()
RETURNS JSON
LANGUAGE plpgsql
SET search_path = public, pg_catalog
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'table_name', t.table_name,
      'primary_key', a.attname
    )
    ORDER BY t.table_name
  ) INTO result
  FROM information_schema.tables t
  JOIN pg_class c ON c.relname = t.table_name
  JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  
  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Function to discover all tables
CREATE OR REPLACE FUNCTION discover_tables()
RETURNS JSON
LANGUAGE plpgsql
SET search_path = public, pg_catalog
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object('table_name', table_name)
    ORDER BY table_name
  ) INTO result
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name NOT LIKE 'pg_%'
    AND table_name NOT LIKE '_%';
  
  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION discover_foreign_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION discover_foreign_keys() TO anon;
GRANT EXECUTE ON FUNCTION discover_primary_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION discover_primary_keys() TO anon;
GRANT EXECUTE ON FUNCTION discover_tables() TO authenticated;
GRANT EXECUTE ON FUNCTION discover_tables() TO anon;

-- Add comments
COMMENT ON FUNCTION discover_foreign_keys() IS 'Returns all foreign key relationships in the database as JSON';
COMMENT ON FUNCTION discover_primary_keys() IS 'Returns all primary key columns for tables in the database as JSON';
COMMENT ON FUNCTION discover_tables() IS 'Returns all tables in the public schema as JSON';
