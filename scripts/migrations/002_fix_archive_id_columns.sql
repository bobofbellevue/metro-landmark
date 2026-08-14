-- Fix for archive_entity function - corrects ID column name mapping
-- Run this in Supabase SQL Editor to fix the "landlords_id does not exist" error

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
    v_id_column TEXT;
BEGIN
    -- Validate table name and map to correct ID column
    CASE p_table_name
        WHEN 'pm_companies' THEN v_id_column := 'pmc_id';
        WHEN 'users' THEN v_id_column := 'user_id';
        WHEN 'landlords' THEN v_id_column := 'landlord_id';
        WHEN 'properties' THEN v_id_column := 'property_id';
        WHEN 'units' THEN v_id_column := 'unit_id';
        WHEN 'applicants' THEN v_id_column := 'applicant_id';
        WHEN 'vendors' THEN v_id_column := 'vendor_id';
        WHEN 'leases' THEN v_id_column := 'lease_id';
        WHEN 'maintenance_requests' THEN v_id_column := 'request_id';
        WHEN 'templates' THEN v_id_column := 'template_id';
        WHEN 'application_units' THEN v_id_column := 'application_id';
        ELSE RAISE EXCEPTION 'Invalid table name: %', p_table_name;
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
        v_id_column,
        p_entity_id
    );
    
    EXECUTE v_sql;

    -- Cascade archiving for related entities
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
        END IF;
    END IF;
END;
$$;

-- Also fix restore_entity function
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
    v_id_column TEXT;
BEGIN
    -- Validate table name and map to correct ID column
    CASE p_table_name
        WHEN 'pm_companies' THEN v_id_column := 'pmc_id';
        WHEN 'users' THEN v_id_column := 'user_id';
        WHEN 'landlords' THEN v_id_column := 'landlord_id';
        WHEN 'properties' THEN v_id_column := 'property_id';
        WHEN 'units' THEN v_id_column := 'unit_id';
        WHEN 'applicants' THEN v_id_column := 'applicant_id';
        WHEN 'vendors' THEN v_id_column := 'vendor_id';
        WHEN 'leases' THEN v_id_column := 'lease_id';
        WHEN 'maintenance_requests' THEN v_id_column := 'request_id';
        WHEN 'templates' THEN v_id_column := 'template_id';
        WHEN 'application_units' THEN v_id_column := 'application_id';
        ELSE RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END CASE;

    -- Restore entity
    v_sql := format('
        UPDATE %I 
        SET is_archived = false,
            archived_at = NULL,
            archived_by_user_id = NULL,
            archive_reason = NULL
        WHERE %I = %s
        AND is_archived = true',
        p_table_name,
        v_id_column,
        p_entity_id
    );
    
    EXECUTE v_sql;
END;
$$;

-- Also fix hard_delete_entity function
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
    v_id_column TEXT;
    v_has_relationships BOOLEAN := false;
BEGIN
    -- Validate table name and map to correct ID column
    CASE p_table_name
        WHEN 'pm_companies' THEN v_id_column := 'pmc_id';
        WHEN 'users' THEN v_id_column := 'user_id';
        WHEN 'landlords' THEN v_id_column := 'landlord_id';
        WHEN 'properties' THEN v_id_column := 'property_id';
        WHEN 'units' THEN v_id_column := 'unit_id';
        WHEN 'applicants' THEN v_id_column := 'applicant_id';
        WHEN 'vendors' THEN v_id_column := 'vendor_id';
        WHEN 'leases' THEN v_id_column := 'lease_id';
        WHEN 'maintenance_requests' THEN v_id_column := 'request_id';
        WHEN 'templates' THEN v_id_column := 'template_id';
        WHEN 'application_units' THEN v_id_column := 'application_id';
        ELSE RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END CASE;

    -- Check for relationships (unless force is true)
    IF NOT p_force THEN
        -- Check if entity has relationships that would be lost
        IF p_table_name = 'landlords' THEN
            SELECT EXISTS(SELECT 1 FROM properties WHERE landlord_id = p_entity_id)
            INTO v_has_relationships;
        ELSIF p_table_name = 'properties' THEN
            SELECT EXISTS(SELECT 1 FROM units WHERE property_id = p_entity_id)
            INTO v_has_relationships;
        ELSIF p_table_name = 'units' THEN
            SELECT EXISTS(SELECT 1 FROM leases WHERE unit_id = p_entity_id)
            INTO v_has_relationships;
        END IF;

        IF v_has_relationships THEN
            RAISE EXCEPTION 'Cannot hard delete % with ID % because it has related records. Archive instead, or use force=true to override.', 
                p_table_name, p_entity_id;
        END IF;
    END IF;

    -- Perform hard delete
    v_sql := format('DELETE FROM %I WHERE %I = %s', 
        p_table_name,
        v_id_column,
        p_entity_id
    );
    
    EXECUTE v_sql;
END;
$$;
