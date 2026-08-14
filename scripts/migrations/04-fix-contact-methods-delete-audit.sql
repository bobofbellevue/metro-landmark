-- Migration: Fix delete_with_audit function to use correct primary key for contact_methods
-- This ensures the function uses 'method_id' instead of 'contact_method_id'

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
        WHEN 'contact_methods' THEN v_pk_column := 'method_id';  -- Fixed: was 'contact_method_id'
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

