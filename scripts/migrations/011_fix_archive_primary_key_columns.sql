-- Migration: Fix archive function primary key column names
-- This fixes the issue where archive functions were using incorrect column names
-- like "pm_companies_id" instead of "pmc_id", "landlords_id" instead of "landlord_id", etc.

-- Update archive_entity function to use correct primary key column names
CREATE OR REPLACE FUNCTION archive_entity(
    p_table_name TEXT,
    p_entity_id INTEGER,
    p_archived_by_user_id INTEGER,
    p_archive_reason TEXT DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_sql TEXT;
    v_pk_column TEXT;
BEGIN
    -- Validate table name to prevent SQL injection
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                           'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Set session variables for audit logging
    IF p_archived_by_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_archived_by_user_id::TEXT, false);
    END IF;

    -- Determine primary key column name based on table
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
        ELSE v_pk_column := p_table_name || '_id'; -- Fallback
    END CASE;

    -- Set archiving fields
    v_sql := format('
        UPDATE %I 
        SET is_archived = true,
            archived_at = CURRENT_TIMESTAMP,
            archived_by_user_id = %s,
            archive_reason = %L
        WHERE %I = %s
        AND is_archived = false',
        p_table_name,
        p_archived_by_user_id,
        COALESCE(p_archive_reason, 'No reason provided'),
        v_pk_column,
        p_entity_id
    );
    
    EXECUTE v_sql;

    -- Cascade archiving for related entities (unchanged from original)
    IF p_cascade THEN
        -- Archive related entities based on table type
        IF p_table_name = 'landlords' THEN
            -- Archive all properties owned by this landlord
            UPDATE properties 
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: landlord %s archived', p_entity_id)
            WHERE landlord_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'properties' THEN
            -- Archive all units in this property
            UPDATE units
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: property %s archived', p_entity_id)
            WHERE property_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'units' THEN
            -- Archive all leases for this unit
            UPDATE leases
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: unit %s archived', p_entity_id)
            WHERE unit_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'pm_companies' THEN
            -- Archive all users, landlords, and properties associated with this company
            UPDATE users
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: PM company %s archived', p_entity_id)
            WHERE pmc_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'users' THEN
            -- Check if user is a landlord and archive their properties
            UPDATE properties
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: user %s archived', p_entity_id)
            WHERE landlord_id IN (
                SELECT landlord_id FROM landlords WHERE user_id = p_entity_id
            )
            AND is_archived = false;
            
        ELSIF p_table_name = 'clients' THEN
            -- Archive client applications and lease clients
            UPDATE client_applications
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: client %s archived', p_entity_id)
            WHERE client_id = p_entity_id
            AND is_archived = false;

            UPDATE lease_clients
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: client %s archived', p_entity_id)
            WHERE client_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'leases' THEN
            UPDATE lease_clients
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: lease %s archived', p_entity_id)
            WHERE lease_id = p_entity_id
            AND is_archived = false;
        END IF;
    END IF;
END;
$$;

-- Update restore_entity function to use correct primary key column names
CREATE OR REPLACE FUNCTION restore_entity(
    p_table_name TEXT,
    p_entity_id INTEGER,
    p_restored_by_user_id INTEGER
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
                           'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Set session variables for audit logging
    IF p_restored_by_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_restored_by_user_id::TEXT, false);
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
        ELSE v_pk_column := 'id';
    END CASE;

    -- Restore entity
    v_sql := format('
        UPDATE %I 
        SET is_archived = false,
            archived_at = NULL,
            archived_by_user_id = NULL,
            archive_reason = NULL
        WHERE %I = $1
        AND is_archived = true',
        p_table_name,
        v_pk_column
    );
    
    EXECUTE v_sql USING p_entity_id;
END;
$$;

-- Update hard_delete_entity function to use correct primary key column names
CREATE OR REPLACE FUNCTION hard_delete_entity(
    p_table_name TEXT,
    p_entity_id INTEGER,
    p_deleted_by_user_id INTEGER,
    p_force BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_sql TEXT;
    v_pk_column TEXT;
    v_has_relationships BOOLEAN := false;
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                           'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices') THEN
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
        ELSE v_pk_column := 'id';
    END CASE;

    -- Check for relationships (unless force is true)
    IF NOT p_force THEN
        -- Check if entity has relationships that would be lost
        IF p_table_name = 'landlords' THEN
            SELECT EXISTS(SELECT 1 FROM properties WHERE landlord_id = p_entity_id) INTO v_has_relationships;
        ELSIF p_table_name = 'properties' THEN
            SELECT EXISTS(SELECT 1 FROM units WHERE property_id = p_entity_id) INTO v_has_relationships;
        ELSIF p_table_name = 'units' THEN
            SELECT EXISTS(SELECT 1 FROM leases WHERE unit_id = p_entity_id) INTO v_has_relationships;
        ELSIF p_table_name = 'clients' THEN
            SELECT EXISTS(SELECT 1 FROM client_applications WHERE client_id = p_entity_id 
                         UNION SELECT 1 FROM lease_clients WHERE client_id = p_entity_id) INTO v_has_relationships;
        ELSIF p_table_name = 'leases' THEN
            SELECT EXISTS(SELECT 1 FROM lease_clients WHERE lease_id = p_entity_id) INTO v_has_relationships;
        ELSIF p_table_name = 'pm_companies' THEN
            SELECT EXISTS(SELECT 1 FROM users WHERE pmc_id = p_entity_id) INTO v_has_relationships;
        END IF;

        IF v_has_relationships THEN
            RAISE EXCEPTION 'Cannot delete entity with existing relationships. Archive instead, or use p_force=true to override.';
        END IF;
    END IF;

    -- Hard delete the entity
    v_sql := format('DELETE FROM %I WHERE %I = $1', p_table_name, v_pk_column);
    EXECUTE v_sql USING p_entity_id;
END;
$$;

