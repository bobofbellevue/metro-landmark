-- ============================================================================
-- Migration: Remove IP Address and User Agent, Add Audit Wrapper Functions
-- ============================================================================
-- This migration:
-- 1. Removes ip_address column from audit_logs table
-- 2. Removes user_agent column from audit_logs table
-- 3. Updates audit trigger function to remove IP address and user_agent handling
-- 4. Creates RPC wrapper functions for common operations to capture user_id
-- ============================================================================

-- Remove ip_address and user_agent columns from audit_logs if they exist
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'ip_address'
    ) THEN
        ALTER TABLE audit_logs DROP COLUMN ip_address;
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'user_agent'
    ) THEN
        ALTER TABLE audit_logs DROP COLUMN user_agent;
    END IF;
END $$;

-- Update audit trigger function to remove IP address and user_agent handling
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old_values JSONB;
  v_new_values JSONB;
  v_changed_fields TEXT[];
  v_record_id INTEGER;
  v_table_name TEXT;
  v_pk_column TEXT;
  v_user_id INTEGER;
BEGIN
  v_table_name := TG_TABLE_NAME;
  
  -- Determine primary key column name based on table
  CASE v_table_name
    WHEN 'pm_companies' THEN v_pk_column := 'pmc_id';
    WHEN 'users' THEN v_pk_column := 'user_id';
    WHEN 'landlords' THEN v_pk_column := 'landlord_id';
    WHEN 'properties' THEN v_pk_column := 'property_id';
    WHEN 'units' THEN v_pk_column := 'unit_id';
    WHEN 'clients' THEN v_pk_column := 'client_id';
    WHEN 'vendors' THEN v_pk_column := 'vendor_id';
    WHEN 'leases' THEN v_pk_column := 'lease_id';
    WHEN 'maintenance_requests' THEN v_pk_column := 'request_id';
    WHEN 'templates' THEN v_pk_column := 'template_id';
    WHEN 'client_applications' THEN v_pk_column := 'application_id';
    WHEN 'lease_clients' THEN v_pk_column := 'lease_client_id';
    WHEN 'compliance_workflows' THEN v_pk_column := 'workflow_id';
    WHEN 'compliance_policies' THEN v_pk_column := 'policy_id';
    WHEN 'documents' THEN v_pk_column := 'document_id';
    WHEN 'legal_notices' THEN v_pk_column := 'notice_id';
    WHEN 'client_units' THEN v_pk_column := 'client_unit_id';
    ELSE v_pk_column := 'id'; -- Fallback
  END CASE;
  
  -- Get record ID and values
  IF TG_OP = 'DELETE' THEN
    EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING OLD INTO v_record_id;
    v_old_values := to_jsonb(OLD);
    v_new_values := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    -- For INSERT, extract ID directly from NEW record first
    -- SERIAL columns should have their value assigned before BEFORE trigger fires
    BEGIN
      EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING NEW INTO v_record_id;
    EXCEPTION WHEN OTHERS THEN
      -- If direct extraction fails, try from JSONB
      v_new_values := to_jsonb(NEW);
      v_record_id := (v_new_values->>v_pk_column)::INTEGER;
    END;
    
    -- Convert to JSONB for storing values
    IF v_new_values IS NULL THEN
      v_new_values := to_jsonb(NEW);
    END IF;
    v_old_values := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING NEW INTO v_record_id;
    v_old_values := to_jsonb(OLD);
    v_new_values := to_jsonb(NEW);
    
    -- Calculate changed fields
    SELECT array_agg(key)
    INTO v_changed_fields
    FROM jsonb_each(v_new_values)
    WHERE jsonb_extract_path(v_old_values, key) IS DISTINCT FROM value;
  END IF;

  -- Get user_id from session variables
  BEGIN
    v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- Mask sensitive data before storing
  v_old_values := mask_sensitive_data(v_old_values);
  v_new_values := mask_sensitive_data(v_new_values);

  -- Insert audit log (only if audit_logs table exists and record_id is not NULL)
  IF v_record_id IS NOT NULL AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
    INSERT INTO audit_logs (
      table_name,
      record_id,
      action,
      user_id,
      old_values,
      new_values,
      changed_fields
    ) VALUES (
      v_table_name,
      v_record_id,
      TG_OP,
      v_user_id,
      v_old_values,
      v_new_values,
      v_changed_fields
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- ============================================================================
-- RPC Wrapper Functions for Common Operations
-- ============================================================================
-- These functions set session variables before executing operations,
-- ensuring user_id is captured in audit logs
-- ============================================================================

-- Generic insert wrapper (for single record)
-- Note: This function expects a single JSONB object, not an array
CREATE OR REPLACE FUNCTION insert_with_audit(
    p_table_name TEXT,
    p_data JSONB,
    p_user_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_result JSONB;
    v_sql TEXT;
    v_row RECORD;
    v_columns TEXT;
    v_values TEXT;
    v_type_def TEXT;
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                           'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices',
                           'addresses', 'contacts', 'contact_methods', 'unit_features', 'property_amenities') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Set session variable for audit logging
    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::TEXT, false);
    END IF;

    -- Build dynamic INSERT statement
    -- Only include columns that are in the JSONB, allowing SERIAL columns to use defaults
    -- Build column list and use jsonb_to_record with proper type casting
    SELECT 
        string_agg(quote_ident(key), ', ' ORDER BY key),
        string_agg(
            format('x.%I', key),
            ', ' ORDER BY key
        )
    INTO v_columns, v_values
    FROM jsonb_object_keys(p_data) AS key;
    
    -- Build type definition for jsonb_to_record based on actual column types
    SELECT string_agg(
        format('%s %s', quote_ident(key),
            COALESCE(
                (SELECT 
                    CASE 
                        WHEN data_type = 'integer' OR udt_name = 'int4' THEN 'integer'
                        WHEN data_type = 'bigint' OR udt_name = 'int8' THEN 'bigint'
                        WHEN data_type = 'smallint' OR udt_name = 'int2' THEN 'smallint'
                        WHEN data_type = 'numeric' THEN 'numeric'
                        WHEN data_type = 'real' OR udt_name = 'float4' THEN 'real'
                        WHEN data_type = 'double precision' OR udt_name = 'float8' THEN 'double precision'
                        WHEN data_type = 'boolean' OR udt_name = 'bool' THEN 'boolean'
                        WHEN data_type LIKE 'timestamp%' THEN 'timestamp'
                        WHEN data_type = 'date' THEN 'date'
                        WHEN data_type LIKE 'time%' THEN 'time'
                        WHEN data_type = 'jsonb' THEN 'jsonb'
                        WHEN data_type = 'json' THEN 'json'
                        ELSE 'text'
                    END
                 FROM information_schema.columns 
                 WHERE table_schema = 'public'
                 AND table_name = p_table_name 
                 AND column_name = key
                 LIMIT 1),
                'text'
            )
        ),
        ', ' ORDER BY key
    )
    INTO v_type_def
    FROM jsonb_object_keys(p_data) AS key;
    
    -- Build INSERT using jsonb_to_record with explicit columns
    -- This only sets columns in the JSONB, allowing SERIAL columns to use defaults
    v_sql := format('INSERT INTO %I (%s) SELECT %s FROM jsonb_to_record($1) AS x(%s) RETURNING *',
                    p_table_name, v_columns, v_values, v_type_def);
    EXECUTE v_sql USING p_data INTO v_row;
    
    -- Convert row to JSONB
    v_result := to_jsonb(v_row);
    
    RETURN v_result;
END;
$$;

-- Generic update wrapper
CREATE OR REPLACE FUNCTION update_with_audit(
    p_table_name TEXT,
    p_record_id INTEGER,
    p_data JSONB,
    p_user_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_result JSONB;
    v_sql TEXT;
    v_set_clause TEXT;
    v_pk_column TEXT;
    v_row RECORD;
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                           'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices',
                           'addresses', 'contacts', 'contact_methods', 'unit_features', 'property_amenities') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Determine primary key column
    CASE p_table_name
        WHEN 'pm_companies' THEN v_pk_column := 'pmc_id';
        WHEN 'users' THEN v_pk_column := 'user_id';
        WHEN 'landlords' THEN v_pk_column := 'landlord_id';
        WHEN 'properties' THEN v_pk_column := 'property_id';
        WHEN 'units' THEN v_pk_column := 'unit_id';
        WHEN 'clients' THEN v_pk_column := 'client_id';
        WHEN 'vendors' THEN v_pk_column := 'vendor_id';
        WHEN 'leases' THEN v_pk_column := 'lease_id';
        WHEN 'maintenance_requests' THEN v_pk_column := 'request_id';
        WHEN 'templates' THEN v_pk_column := 'template_id';
        WHEN 'client_applications' THEN v_pk_column := 'application_id';
        WHEN 'lease_clients' THEN v_pk_column := 'lease_client_id';
        WHEN 'compliance_workflows' THEN v_pk_column := 'workflow_id';
        WHEN 'compliance_policies' THEN v_pk_column := 'policy_id';
        WHEN 'documents' THEN v_pk_column := 'document_id';
        WHEN 'legal_notices' THEN v_pk_column := 'notice_id';
        WHEN 'client_units' THEN v_pk_column := 'client_unit_id';
        WHEN 'addresses' THEN v_pk_column := 'address_id';
        WHEN 'contacts' THEN v_pk_column := 'contact_id';
        WHEN 'contact_methods' THEN v_pk_column := 'method_id';
        ELSE v_pk_column := 'id';
    END CASE;

    -- Set session variable for audit logging
    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::TEXT, false);
    END IF;

    -- Build dynamic UPDATE statement using jsonb_populate_record
    -- Use a CTE to populate record, then update from it
    -- Build SET clause: column = source.column for each column in JSONB
    SELECT string_agg(
        format('%I = s.%I', key, key),
        ', '
    )
    INTO v_set_clause
    FROM jsonb_object_keys(p_data) AS key;
    
    -- Execute UPDATE with CTE
    v_sql := format('WITH s AS (SELECT * FROM jsonb_populate_record((SELECT NULL::%I), $1)) UPDATE %I t SET %s FROM s WHERE t.%I = $2 RETURNING t.*', 
                    p_table_name, p_table_name, v_set_clause, v_pk_column);
    EXECUTE v_sql USING p_data, p_record_id INTO v_row;
    
    -- Convert row to JSONB
    v_result := to_jsonb(v_row);
    
    RETURN v_result;
END;
$$;

-- Generic delete wrapper
CREATE OR REPLACE FUNCTION delete_with_audit(
    p_table_name TEXT,
    p_record_id INTEGER,
    p_user_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_sql TEXT;
    v_pk_column TEXT;
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                           'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices',
                           'addresses', 'contacts', 'contact_methods', 'unit_features', 'property_amenities') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Determine primary key column
    CASE p_table_name
        WHEN 'pm_companies' THEN v_pk_column := 'pmc_id';
        WHEN 'users' THEN v_pk_column := 'user_id';
        WHEN 'landlords' THEN v_pk_column := 'landlord_id';
        WHEN 'properties' THEN v_pk_column := 'property_id';
        WHEN 'units' THEN v_pk_column := 'unit_id';
        WHEN 'clients' THEN v_pk_column := 'client_id';
        WHEN 'vendors' THEN v_pk_column := 'vendor_id';
        WHEN 'leases' THEN v_pk_column := 'lease_id';
        WHEN 'maintenance_requests' THEN v_pk_column := 'request_id';
        WHEN 'templates' THEN v_pk_column := 'template_id';
        WHEN 'client_applications' THEN v_pk_column := 'application_id';
        WHEN 'lease_clients' THEN v_pk_column := 'lease_client_id';
        WHEN 'compliance_workflows' THEN v_pk_column := 'workflow_id';
        WHEN 'compliance_policies' THEN v_pk_column := 'policy_id';
        WHEN 'documents' THEN v_pk_column := 'document_id';
        WHEN 'legal_notices' THEN v_pk_column := 'notice_id';
        WHEN 'client_units' THEN v_pk_column := 'client_unit_id';
        WHEN 'addresses' THEN v_pk_column := 'address_id';
        WHEN 'contacts' THEN v_pk_column := 'contact_id';
        WHEN 'contact_methods' THEN v_pk_column := 'method_id';
        ELSE v_pk_column := 'id';
    END CASE;

    -- Set session variable for audit logging
    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::TEXT, false);
    END IF;

    -- Build and execute DELETE statement
    v_sql := format('DELETE FROM %I WHERE %I = $1', p_table_name, v_pk_column);
    EXECUTE v_sql USING p_record_id;
END;
$$;

